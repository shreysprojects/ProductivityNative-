import AsyncStorage from '@react-native-async-storage/async-storage'
import { Alert } from 'react-native'
import * as StoreReview from 'expo-store-review'

const FLAG = '@review_prompted_v1'

// Shows a one-time "are you enjoying the app?" prompt and, if the user is
// positive, triggers the native in-app review. Runs at most ONCE per install —
// the flag is set the first time it's called, regardless of the user's answer.
export async function maybePromptReview() {
  try {
    if (await AsyncStorage.getItem(FLAG)) return
    await AsyncStorage.setItem(FLAG, '1')
  } catch {
    return
  }

  Alert.alert(
    'Enjoying LifeLayer? 🎉',
    "Nice work finishing your first routine! If you're enjoying the app, would you mind leaving a quick review?",
    [
      { text: 'Maybe later', style: 'cancel' },
      { text: 'Sure!', onPress: requestReview },
    ],
  )
}

async function requestReview() {
  try {
    if (await StoreReview.isAvailableAsync()) {
      await StoreReview.requestReview()
    }
  } catch {}
}
