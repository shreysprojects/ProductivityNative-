-- Gives back one use of an AI limit when the request that took it was refused
-- before any paid model call: its input was flagged by the free moderation
-- check, the image was bad or too large, or the check itself failed. Nothing
-- was spent and the user got nothing, so it should not count against the
-- 3-a-day generative limit (or the food, helper, meal plan and import caps).
--
-- The use moves to the day's moderation counter instead of vanishing (the
-- proxy passes that counter's cap), so refusals stay bounded: once it is
-- full, a refusal counts against the limit again, as it always did.
-- Called only by the openai-proxy edge function (service role).

CREATE OR REPLACE FUNCTION public.refund_ai_limit(p_user UUID, p_kind TEXT, p_mod_max INT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mod INT;
BEGIN
  -- The owner's exemption never took a use in the first place.
  IF EXISTS (SELECT 1 FROM public.ai_limit_exemptions e WHERE e.user_id = p_user) THEN
    RETURN false;
  END IF;
  IF p_kind NOT IN ('generative', 'workout', 'food', 'light', 'mealplan') THEN
    RETURN false;
  END IF;

  -- Charge the moderation counter, but only while it has room.
  INSERT INTO public.ai_mod_limits AS m (user_id, date, count)
  VALUES (p_user, current_date, 1)
  ON CONFLICT (user_id, date) DO UPDATE SET count = m.count + 1
    WHERE m.count < p_mod_max
  RETURNING m.count INTO v_mod;
  IF v_mod IS NULL THEN
    RETURN false;
  END IF;

  IF p_kind = 'generative' THEN
    UPDATE public.ai_rate_limits SET count = count - 1
     WHERE user_id = p_user AND date = current_date AND count > 0;
  ELSIF p_kind = 'workout' THEN
    UPDATE public.ai_workout_limits SET count = count - 1
     WHERE user_id = p_user AND week_start = date_trunc('week', current_date)::DATE AND count > 0;
  ELSIF p_kind = 'food' THEN
    UPDATE public.ai_food_limits SET count = count - 1
     WHERE user_id = p_user AND date = current_date AND count > 0;
  ELSIF p_kind = 'light' THEN
    UPDATE public.ai_light_limits SET count = count - 1
     WHERE user_id = p_user AND date = current_date AND count > 0;
  ELSE
    UPDATE public.ai_mealplan_limits SET count = count - 1
     WHERE user_id = p_user AND date = current_date AND count > 0;
  END IF;

  IF NOT FOUND THEN
    -- Nothing to give back (the day turned over in between): undo the charge.
    UPDATE public.ai_mod_limits SET count = count - 1
     WHERE user_id = p_user AND date = current_date AND count > 0;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_ai_limit(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_ai_limit(UUID, TEXT, INT) TO service_role;
