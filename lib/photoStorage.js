import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Fitness progress photos: one per date, copied into the app's document
// directory so they survive cache clears. Index lives in AsyncStorage:
// { [YYYY-MM-DD]: fileUri }

const key = (uid) => `@fit_photos_${uid}`
const passKey = (uid) => `fitpass_${uid}`
const PHOTO_DIR = FileSystem.documentDirectory + 'fitphotos/'

export async function getFitPhotos(userId) {
  try {
    const raw = await AsyncStorage.getItem(key(userId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export async function saveFitPhoto(userId, date, srcUri) {
  await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => {})
  const dest = `${PHOTO_DIR}${userId}_${date}_${Date.now()}.jpg`
  await FileSystem.copyAsync({ from: srcUri, to: dest })
  const map = await getFitPhotos(userId)
  // Replace any previous photo for the same day
  if (map[date]) await FileSystem.deleteAsync(map[date], { idempotent: true }).catch(() => {})
  map[date] = dest
  await AsyncStorage.setItem(key(userId), JSON.stringify(map))
  return dest
}

export async function deleteFitPhoto(userId, date) {
  const map = await getFitPhotos(userId)
  if (map[date]) {
    await FileSystem.deleteAsync(map[date], { idempotent: true }).catch(() => {})
    delete map[date]
    await AsyncStorage.setItem(key(userId), JSON.stringify(map))
  }
}

// ── Passcode protection (stored in the device secure enclave) ──────────────

export async function getPhotoPasscode(userId) {
  try { return await SecureStore.getItemAsync(passKey(userId)) } catch { return null }
}

export async function setPhotoPasscode(userId, code) {
  if (code) await SecureStore.setItemAsync(passKey(userId), code)
  else await SecureStore.deleteItemAsync(passKey(userId)).catch(() => {})
}
