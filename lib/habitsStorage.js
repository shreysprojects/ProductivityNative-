import AsyncStorage from '@react-native-async-storage/async-storage'

const key = (uid) => `@habits_${uid}`

export async function loadHabits(userId) {
  try {
    const raw = await AsyncStorage.getItem(key(userId))
    if (!raw) return { breaking: [], building: [], tips: '' }
    const p = JSON.parse(raw)
    return { breaking: p.breaking ?? [], building: p.building ?? [], tips: p.tips ?? '' }
  } catch {
    return { breaking: [], building: [], tips: '' }
  }
}

export async function saveHabits(userId, data) {
  await AsyncStorage.setItem(key(userId), JSON.stringify(data))
}
