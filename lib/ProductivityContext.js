import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { saveProductivitySession } from './productivityStorage'

const ProductivityContext = createContext(null)

function _localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export function ProductivityProvider({ children }) {
  const { user } = useAuth()
  const [activeSession, setActiveSession] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const intervalRef = useRef(null)

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    stopTimer()
    intervalRef.current = setInterval(() => {
      setElapsedSeconds(s => s + 1)
    }, 1000)
  }, [stopTimer])

  useEffect(() => {
    if (activeSession && !activeSession.pausedAt) {
      startTimer()
    } else {
      stopTimer()
    }
    return stopTimer
  }, [activeSession?.pausedAt, !!activeSession, startTimer, stopTimer])

  function startSession(taskDesc, goalMins) {
    setActiveSession({
      taskDesc,
      goalMins,
      startedAt: Date.now(),
      totalPausedMs: 0,
      pausedAt: null,
    })
    setElapsedSeconds(0)
  }

  function pause() {
    setActiveSession(prev => prev && !prev.pausedAt ? { ...prev, pausedAt: Date.now() } : prev)
  }

  function resume() {
    setActiveSession(prev => {
      if (!prev?.pausedAt) return prev
      const pausedDuration = Date.now() - prev.pausedAt
      return { ...prev, totalPausedMs: prev.totalPausedMs + pausedDuration, pausedAt: null }
    })
  }

  function abandonSession() {
    stopTimer()
    setActiveSession(null)
    setElapsedSeconds(0)
  }

  async function endSession(rating, notes = '') {
    if (!activeSession || !user) return null
    stopTimer()
    const endedAt = Date.now()
    const pausedMs = activeSession.totalPausedMs + (activeSession.pausedAt ? Date.now() - activeSession.pausedAt : 0)
    const actualMs = Math.max(endedAt - activeSession.startedAt - pausedMs, 0)
    const actualMins = actualMs > 0 ? Math.max(1, Math.round(actualMs / 60000)) : 0
    const session = {
      date: _localDate(new Date(activeSession.startedAt)),
      taskDesc: activeSession.taskDesc,
      goalMins: activeSession.goalMins,
      actualMins,
      rating,
      notes,
      startedAt: activeSession.startedAt,
      endedAt,
    }
    setActiveSession(null)
    setElapsedSeconds(0)
    return saveProductivitySession(user.id, session)
  }

  const [showSessionModal, setShowSessionModal] = useState(false)
  const openSession  = () => setShowSessionModal(true)
  const closeSession = () => setShowSessionModal(false)

  return (
    <ProductivityContext.Provider value={{
      activeSession,
      elapsedSeconds,
      isPaused: activeSession?.pausedAt != null,
      startSession,
      pause,
      resume,
      endSession,
      abandonSession,
      showSessionModal,
      openSession,
      closeSession,
    }}>
      {children}
    </ProductivityContext.Provider>
  )
}

export function useProductivity() {
  return useContext(ProductivityContext)
}
