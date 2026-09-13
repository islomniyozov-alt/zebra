'use client'

// ---------------------------------------------------------------------------
// EVERY FILE ON THIS DRIVER, INCLUDING THE ONES NOBODY READ.
//
// ── WHY THIS EXISTS, WHICH IS NOT "A DRIVER SHOULD HAVE A DOCUMENTS TAB" ──
//
// `CompliancePanel` lists documents PER COMPLIANCE RECORD — a medical card
// under the medical row, a licence under the licence row. That is the right
// shape for a document that was read, because reading it is what produced the
// record to hang it under.
//
// A CANCELLED ROTATION PRODUCES NO RECORD. Nothing was read, so there is no
// compliance row, so a panel keyed on compliance rows cannot show it — and a
// file that exists but appears on no screen is worse than one that was never
// kept: it is storage nobody is going to act on.
//
// So this lists documents by DRIVER, and its first job is the parked ones.
// Owner's ruling, 2026-09-12: "a cancelled rotation leaves the upload on the
// driver as 'not read — needs rotation', visible on the document list."
//
// READ-ONLY, AND DELIBERATELY PLAIN. It is not an uploader and not a viewer;
// `CompliancePanel` owns attaching, and a second control for the same act is a
// second place for the accept list to drift.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { downscaleImage } from '../drivers/new/downscale'
import { uploadDocument } from '@/lib/upload-client'
import { rotateAndRead } from '@/lib/rotate-and-read'
import { UprightCard } from '@/components/UprightCard'

export interface DriverDocumentRow {
  id: string
  filename: string
  /** The one state this panel exists to make visible. */
  needsRotation: boolean
  uploadedAt: Date
}

interface Props {
  documents: readonly DriverDocumentRow[]
  /** Whose page this is. The rotated copy hangs off the same driver. */
  driverId: string
  /** Null when the reader may not file compliance — then there is no button. */
  mayRead: boolean
  labels: {
    heading: string
    none: string
    needsRotation: string
    rotateAndRead: string
    working: string
    readOk: string
    readFailed: string
    upright: {
      title: string
      hint: string
      rotateLeft: string
      rotateRight: string
      read: string
      cancel: string
    }
  }
}

const day = (value: Date) => value.toISOString().slice(0, 10)

export function DriverDocuments({
  documents,
  driverId,
  mayRead,
  labels,
}: Props) {
  /** The parked document a person is currently turning. */
  const [turning, setTurning] = useState<DriverDocumentRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Fetch it, turn it, store the turned copy, read THAT.
   *
   * THE PREVIEW IS A PLACEHOLDER, and it is the one compromise here. The
   * person turns a stand-in rather than the stored card, because showing the
   * real one needs a signed URL fetched before the dialog opens — worth doing,
   * and not worth blocking the read on. `rotateAndRead` downloads the real
   * bytes either way, so the TURNS are what the preview is for.
   */
  const run = async (document: DriverDocumentRow, quarterTurns: number) => {
    setTurning(null)
    setBusy(true)
    setNotice(null)
    try {
      const outcome = await rotateAndRead(
        {
          documentId: document.id,
          driverId,
          documentType: 'MEDICAL_CARD',
          quarterTurns,
          readRoute: '/api/med/read',
        },
        {
          rotate: (file, turns) =>
            downscaleImage(file, { quarterTurns: turns }),
          upload: (file, target) => uploadDocument(file, target),
        },
      )
      // NAMED BY STEP. "It did not work" sends somebody to photograph the card
      // again, which is the trip this whole feature exists to save.
      setNotice(
        outcome.ok ? labels.readOk : `${labels.readFailed} (${outcome.step})`,
      )
    } catch {
      setNotice(labels.readFailed)
    } finally {
      setBusy(false)
    }
  }

  if (turning) {
    return (
      <UprightCard
        file={
          new File([new Uint8Array()], turning.filename, {
            type: 'image/jpeg',
          })
        }
        labels={labels.upright}
        onConfirm={(quarterTurns) => void run(turning, quarterTurns)}
        onCancel={() => setTurning(null)}
      />
    )
  }

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>

      {notice ? (
        <p role="status" className="mt-z2 text-sm text-ink-2">
          {notice}
        </p>
      ) : null}

      {documents.length === 0 ? (
        <p className="mt-z2 text-sm text-ink-3">{labels.none}</p>
      ) : (
        <ul className="mt-z3 flex flex-col gap-z2 text-sm">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-baseline gap-z2"
            >
              <span className="text-ink">{document.filename}</span>
              <span className="font-mono text-xs text-ink-3">
                {day(document.uploadedAt)}
              </span>
              {/* SAID IN WORDS, NOT SHOWN AS AN ABSENCE. A row that simply
               * lacked a green tick would read as "fine" at a glance, and the
               * whole point of keeping this file is that somebody has to do
               * something about it. */}
              {document.needsRotation ? (
                <span className="rounded-card border border-warning bg-warning-soft px-z2 py-px text-xs text-warning">
                  {labels.needsRotation}
                </span>
              ) : null}
              {/* ONLY ON THE ROWS THAT NEED IT, and only for somebody who may
               * file compliance — reading a card to propose a record they
               * cannot create is work done for a refusal. */}
              {document.needsRotation && mayRead ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setTurning(document)}
                  className="rounded-card border border-border px-z2 py-px text-xs text-ink-2 hover:text-ink disabled:text-ink-3"
                >
                  {busy ? labels.working : labels.rotateAndRead}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
