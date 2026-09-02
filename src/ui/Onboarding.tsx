/**
 * The first thirty seconds.
 *
 * Roque Nights looks like a star chart, so a first-time visitor has no reason to
 * suspect that the interesting half of it is an agent calling tools on this very
 * page. Four steps say it, hand over one prompt to paste, and get out of the way.
 * Dismissal is remembered in localStorage; the Header keeps a button to reopen it.
 *
 * The copy and the storage flag live in `onboardingState.ts` so they can be
 * tested without a DOM.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { useRoqueStore } from '../state/store'
import { TOUR_STEPS, clampStep, markOnboardingSeen, promptNote } from './onboardingState'

const LABEL = 'text-[11px] uppercase tracking-[0.2em] text-faint'
const BUTTON =
  'rounded-sm border border-panel-edge px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-faint hover:border-ember/50 hover:text-ember disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-panel-edge disabled:hover:text-faint'
const PRIMARY =
  'rounded-sm border border-ember/60 bg-ember/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-ember hover:bg-ember/20'

/** How long the Copy button stays in its confirmed state. */
export const COPIED_FEEDBACK_MS = 1500

export interface OnboardingProps {
  open: boolean
  onClose: () => void
}

export function Onboarding({ open, onClose }: OnboardingProps) {
  const status = useRoqueStore((s) => s.webmcp.status)
  const [step, setStep] = useState(0)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Resetting on the way out, not on the way in: reopening from the Header has
  // to start at step 1, and doing it in an effect would just cost a render.
  const close = useCallback(() => {
    markOnboardingSeen()
    setStep(0)
    setCopied(false)
    onClose()
  }, [onClose])

  // Esc closes, arrows walk the steps: this thing sits on top of the whole app,
  // so it has to be dismissable without hunting for a button.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key === 'ArrowRight') setStep((s) => clampStep(s + 1))
      if (event.key === 'ArrowLeft') setStep((s) => clampStep(s - 1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  // The panel takes focus so Esc and the arrow keys land inside the dialog.
  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  useEffect(
    () => () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    },
    [],
  )

  const copyPrompt = useCallback(async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(true)
      if (copyTimer.current !== null) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    } catch {
      // No clipboard permission, or an insecure context. The prompt below is
      // selectable, which is the fallback the whole step is built around.
      setCopied(false)
    }
  }, [])

  if (!open) return null

  const current = TOUR_STEPS[clampStep(step)]
  const last = step >= TOUR_STEPS.length - 1
  const note = current.prompt ? promptNote(status) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/85 p-3"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Roque Nights tour"
        tabIndex={-1}
        className="modal-in flex max-h-[min(92dvh,32rem)] w-full max-w-[34rem] flex-col overflow-y-auto rounded-sm border border-panel-edge bg-panel p-4 font-mono outline-none"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={LABEL}>Roque Nights · tour</h2>
          <div className="flex items-baseline gap-3">
            <span className={LABEL}>
              Step {step + 1} / {TOUR_STEPS.length}
            </span>
            <button
              type="button"
              className="text-faint hover:text-ember"
              aria-label="Close the tour"
              onClick={close}
            >
              ×
            </button>
          </div>
        </div>

        <div className="mt-3 min-h-[9rem] flex-1">
          {current.title && (
            <p className="text-sm leading-relaxed text-ember">{current.title}</p>
          )}
          {current.body && (
            <p className="mt-2 text-xs leading-relaxed text-[#e6e9f0]">{current.body}</p>
          )}

          {current.prompt && (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <span className={LABEL}>Paste this into your agent</span>
                <button
                  type="button"
                  className={copied ? `${BUTTON} border-ember/60 text-ember` : BUTTON}
                  onClick={() => {
                    void copyPrompt(current.prompt as string)
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 rounded-sm border border-ember/40 bg-ember/10 px-3 py-2 text-xs leading-relaxed text-ember select-all">
                {current.prompt}
              </p>
              {note && <p className="mt-2 text-[11px] leading-relaxed text-faint">{note}</p>}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-panel-edge pt-3">
          <div className="flex items-center gap-2">
            {TOUR_STEPS.map((tourStep, index) => (
              <button
                key={tourStep.id}
                type="button"
                aria-label={`Go to step ${index + 1}`}
                aria-current={index === step}
                className={`h-2 w-2 rounded-full ${
                  index === step ? 'bg-ember' : 'bg-panel-edge hover:bg-faint'
                }`}
                onClick={() => setStep(index)}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={step === 0}
              onClick={() => setStep((s) => clampStep(s - 1))}
            >
              Back
            </button>
            {last ? (
              <button type="button" className={PRIMARY} onClick={close}>
                Done
              </button>
            ) : (
              <button
                type="button"
                className={PRIMARY}
                onClick={() => setStep((s) => clampStep(s + 1))}
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
