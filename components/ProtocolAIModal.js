import { useState, useEffect, useRef } from 'react'
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView,
  TextInput, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native'
import { supabase } from '../lib/supabase'

// Chat-style AI helper for protocols: the user describes what they're fighting
// (what they want to quit, how the hard moments feel, what they wish they did),
// the AI coaches, then proposes a protocol when it has enough. "Keep talking"
// reopens the chat; the AI folds new info into an updated proposal whenever it
// judges it's ready (or keeps asking). Newest proposal supersedes older ones.
// The server enforces the turn cap; this mirrors it.
const MAX_USER_TURNS = 8

const ERROR_TITLES = {
  daily_limit: 'Daily limit reached',
  flagged: 'Inappropriate content',
  inappropriate: 'Inappropriate content',
  limit_unavailable: 'Try again',
  chat_over: 'Chat finished',
}

// Deterministic safety net: this chat invites disclosures about relapses and
// spirals, so the crisis line lives in the UI itself — always visible, never
// dependent on message content or on what the model chooses to say.
const CRISIS_LINE =
  "If you're in crisis or thinking about harming yourself, call or text 988 (US/Canada) or your local emergency number."

// Assistant turns carry their proposal back to the server as text, so the
// model remembers what it already proposed when the user keeps talking.
const toWire = msgs => msgs.map(m => m.protocol
  ? {
      role: m.role,
      content: `${m.content}\n\n[Protocol you proposed: "${m.protocol.name}" steps: ${
        m.protocol.steps.map((s, i) => `${i + 1}) ${s.text}`).join(' ')}]`,
    }
  : { role: m.role, content: m.content })

export default function ProtocolAIModal({ visible, onClose, theme, color, protocolName, onApply }) {
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // True after "Keep talking": the input returns while the latest proposal
  // stays in the thread. Reset when a fresh proposal arrives.
  const [chatReopened, setChatReopened] = useState(false)
  const scrollRef = useRef(null)
  // Server-issued billing token: the first reply of a chat mints it, and every
  // later turn must echo it back or the server charges that turn as a new chat.
  const chatTokenRef = useRef(null)

  useEffect(() => {
    if (visible) { setMsgs([]); setInput(''); setLoading(false); setChatReopened(false); chatTokenRef.current = null }
  }, [visible])

  const userTurns = msgs.filter(m => m.role === 'user').length
  const lastProtoIdx = msgs.reduce((acc, m, i) => (m.protocol ? i : acc), -1)
  const turnsLeft = userTurns < MAX_USER_TURNS
  const canChat = !loading && turnsLeft && (lastProtoIdx === -1 || chatReopened)

  async function send() {
    const content = input.trim()
    if (!content || loading) return
    const next = [...msgs, { role: 'user', content }]
    setMsgs(next); setInput(''); setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('openai-proxy', {
        body: { action: 'protocol_helper', messages: toWire(next), protocolName, chatToken: chatTokenRef.current ?? undefined },
      })
      let payload = data
      if (error) {
        // Limits/flags come back as non-2xx, so the reason is on the error body.
        let detail = null
        try { detail = await error.context?.json() } catch {}
        if (!detail) throw new Error(error.message ?? 'Request failed')
        payload = detail
      }
      if (payload?.error) {
        // When the server flags what the user wrote, the refusal itself may be
        // the moment they most need the crisis line — so it rides along.
        const flagged = payload.error === 'flagged' || payload.error === 'inappropriate'
        Alert.alert(
          ERROR_TITLES[payload.error] ?? 'Something went wrong',
          (payload.reason ?? 'Please try again.') + (flagged ? `\n\n${CRISIS_LINE}` : '')
        )
        setMsgs(msgs); setInput(content)
        return
      }
      if (payload?.chatToken) chatTokenRef.current = payload.chatToken
      setMsgs([...next, { role: 'assistant', content: payload?.reply || '…', protocol: payload?.protocol ?? null }])
      if (payload?.protocol) setChatReopened(false)
    } catch (e) {
      Alert.alert('Something went wrong', e.message ?? 'Please try again.')
      setMsgs(msgs); setInput(content)
    } finally {
      setLoading(false)
    }
  }

  function startOver() {
    setMsgs([])
    setChatReopened(false)
    setInput('')
    chatTokenRef.current = null
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={c.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={c.bg} onPress={onClose} />
        <View style={[c.sheet, { backgroundColor: theme.card }]}>
          <Pressable onPress={onClose} hitSlop={16}>
            <View style={[c.handle, { backgroundColor: theme.divider }]} />
          </Pressable>
          <Text style={[c.title, { color: theme.text }]}>✦ Protocol AI Helper</Text>

          <ScrollView
            ref={scrollRef}
            style={c.chatArea}
            contentContainerStyle={{ paddingBottom: 8 }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {msgs.length === 0 && (
              <View style={[c.introBox, { backgroundColor: color + '0d', borderColor: color + '35' }]}>
                <Text style={[c.introText, { color: theme.text }]}>
                  Tell me what you're up against: what you want to quit, the feelings or urges that hit you, and what you wish you did in those moments. After a message or two I'll give you advice and build this protocol for you.
                </Text>
              </View>
            )}

            {msgs.map((msg, i) => {
              const isLatestProposal = msg.protocol && i === lastProtoIdx
              return (
                <View key={i}>
                  <View
                    style={[c.bubble, msg.role === 'user'
                      ? [c.bubbleUser, { backgroundColor: color }]
                      : [c.bubbleAI, { backgroundColor: theme.isDark ? '#1e1e38' : '#f1f0fa' }]]}
                  >
                    <Text style={[c.bubbleText, { color: msg.role === 'user' ? '#fff' : theme.text }]}>
                      {msg.content}
                    </Text>
                  </View>

                  {msg.protocol && (
                    <View
                      style={[
                        c.proposalCard,
                        { borderColor: color + '55', backgroundColor: color + '0d' },
                        !isLatestProposal && { opacity: 0.45 },
                      ]}
                    >
                      <Text style={[c.proposalName, { color: theme.text }]}>
                        {msg.protocol.emoji}  {msg.protocol.name}
                        {!isLatestProposal && '  ·  replaced below'}
                      </Text>
                      {msg.protocol.steps.map((s, j) => (
                        <View key={j} style={c.proposalStep}>
                          <Text style={[c.proposalNum, { color }]}>{j + 1}.</Text>
                          <Text style={[c.proposalStepText, { color: theme.text }]}>
                            {s.text}{s.timeGoalMins ? `  ·  ${s.timeGoalMins}m` : ''}
                          </Text>
                        </View>
                      ))}
                      {msg.protocol.note && (
                        <Text style={[c.proposalNote, { color: theme.subtext }]}>
                          ✉️ {msg.protocol.note.title}: {msg.protocol.note.text}
                        </Text>
                      )}
                      {isLatestProposal && (
                        <>
                          <Pressable style={[c.applyBtn, { backgroundColor: color }]} onPress={() => onApply(msg.protocol)}>
                            <Text style={c.applyBtnText}>
                              {protocolName ? 'Replace my protocol with this' : 'Create this protocol'}
                            </Text>
                          </Pressable>
                          {!chatReopened && turnsLeft && (
                            <Pressable
                              style={[c.keepBtn, { borderColor: color + '66' }]}
                              onPress={() => setChatReopened(true)}
                            >
                              <Text style={[c.keepBtnText, { color }]}>💬 Keep talking</Text>
                            </Pressable>
                          )}
                          <Pressable onPress={startOver} style={c.retryLink} hitSlop={8}>
                            <Text style={[c.retryLinkText, { color: theme.muted }]}>↺ Start over</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  )}
                </View>
              )
            })}

            {loading && (
              <View style={[c.bubble, c.bubbleAI, { backgroundColor: theme.isDark ? '#1e1e38' : '#f1f0fa' }]}>
                <ActivityIndicator size="small" color={color} />
              </View>
            )}

            {lastProtoIdx === -1 && !loading && !turnsLeft && (
              <Pressable onPress={startOver} style={c.retryLink} hitSlop={8}>
                <Text style={[c.retryLinkText, { color: theme.muted }]}>↺ Start over</Text>
              </Pressable>
            )}
          </ScrollView>

          {canChat && (
            <View style={c.inputRow}>
              <TextInput
                style={[c.input, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                placeholder={userTurns === 0 ? 'What are you struggling with?' : 'Reply…'}
                placeholderTextColor={theme.muted}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={1500}
              />
              <Pressable
                style={[c.sendBtn, { backgroundColor: color, opacity: input.trim() ? 1 : 0.4 }]}
                onPress={send}
                disabled={!input.trim()}
                hitSlop={6}
              >
                <Text style={c.sendBtnText}>➤</Text>
              </Pressable>
            </View>
          )}

          <Text style={[c.crisisNote, { color: theme.muted }]}>{CRISIS_LINE}</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const c = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '90%',
    paddingTop: 10, paddingHorizontal: 18, paddingBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, marginBottom: 12 },

  chatArea: { flexGrow: 0, minHeight: 180, maxHeight: 420 },
  introBox: { borderRadius: 16, borderWidth: 1, padding: 14 },
  introText: { fontSize: 14, lineHeight: 21, fontWeight: '500' },

  bubble: { borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, marginBottom: 8, maxWidth: '86%' },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 5 },
  bubbleAI: { alignSelf: 'flex-start', borderBottomLeftRadius: 5 },
  bubbleText: { fontSize: 14, lineHeight: 20, fontWeight: '500' },

  proposalCard: { borderRadius: 16, borderWidth: 1.5, padding: 14, marginBottom: 10, marginTop: 2 },
  proposalName: { fontSize: 16, fontWeight: '800', marginBottom: 10 },
  proposalStep: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  proposalNum: { fontSize: 13.5, fontWeight: '800', width: 18 },
  proposalStepText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: '600' },
  proposalNote: { fontSize: 12.5, lineHeight: 18, fontWeight: '500', marginTop: 6, fontStyle: 'italic' },
  applyBtn: { borderRadius: 13, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  applyBtnText: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  keepBtn: {
    borderRadius: 13, borderWidth: 1.5, paddingVertical: 12, alignItems: 'center', marginTop: 8,
  },
  keepBtnText: { fontWeight: '800', fontSize: 14 },
  retryLink: { alignItems: 'center', paddingVertical: 10 },
  retryLinkText: { fontSize: 12.5, fontWeight: '600' },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 },
  input: {
    flex: 1, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10,
    fontSize: 14.5, maxHeight: 110,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  crisisNote: { fontSize: 11.5, lineHeight: 16, fontWeight: '500', textAlign: 'center', marginTop: 10, paddingHorizontal: 8 },
})
