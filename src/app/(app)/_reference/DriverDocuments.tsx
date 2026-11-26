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
// ── AND SINCE v11.30 IT IS WHERE A DRIVER'S PAPER GOES IN ──────────────────
//
// It was read-only and said "No documents on this driver" with nothing to
// press (safety team on dev, 2026-11-17). It now uploads by kind
// (`DRIVER_DOCUMENT_KINDS`), lists the driver's documents AND those attached
// to the driver's compliance records, each with the day it arrived and the
// expiry of what it evidences (`driverDocumentList`), and opens each file.
// Attaching to one record stays the compliance panel's; the upload here is
// on the driver, which is where the DQF reads a document kind from.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { downscaleImage } from '../drivers/new/downscale'
import { uploadDocument } from '@/lib/upload-client'
import {
  READABLE_TYPES,
  fetchDocumentFile,
  storeRotatedAndRead,
} from '@/lib/rotate-and-read'
import { UprightCard } from '@/components/UprightCard'
import { Select } from '@/components/ui/Select'
import { DocumentLink, UploadTo, type UploadLabels } from './DocumentControls'

export interface DriverDocumentRow {
  id: string
  filename: string
  /**
   * What the original is, so the turned copy can be filed as the same thing.
   *
   * CARRIED FROM THE SERVER, not restated by the browser: the page read it off
   * the row it drew, which is the only place it is known.
   */
  type: string
  /** The one state this panel exists to make visible. */
  needsRotation: boolean
  /** The expiry of the record it evidences; null when it evidences nothing dated. */
  expiresAt: Date | null
  /**
   * Whether a better copy of this document now exists.
   *
   * A parked card that has been turned and read keeps its own `needsRotation`
   * — nothing ever read THOSE bytes — so this is what stops the list nagging
   * about work somebody has already done.
   */
  superseded: boolean
  uploadedAt: Date | null
}

interface Props {
  documents: readonly DriverDocumentRow[]
  /** Whose page this is. The rotated copy hangs off the same driver. */
  driverId: string
  /** Null when the reader may not file compliance — then there is no button. */
  mayRead: boolean
  /** `document:create`: the upload control is rendered only then. */
  mayUpload: boolean
  /** The kinds a driver document may be, in the picker's order, translated. */
  kinds: readonly { value: string; label: string }[]
  /** Every document kind's name, for the list (a record's file may be any). */
  kindLabels: Record<string, string>
  labels: {
    heading: string
    none: string
    kind: string
    uploaded: string
    expires: string
    open: string
    upload: UploadLabels
    needsRotation: string
    superseded: string
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

const day = (value: Date | null) =>
  value ? value.toISOString().slice(0, 10) : '—'

export function DriverDocuments({
  documents,
  driverId,
  mayRead,
  mayUpload,
  kinds,
  kindLabels,
  labels,
}: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<string>(kinds[0]?.value ?? 'OTHER')
  /**
   * The parked document a person is currently turning, WITH ITS BYTES.
   *
   * Fetched before the dialog opens, so the preview is the card rather than a
   * blank frame — turning a placeholder is guessing from a filename, which is
   * the act of faith this whole step exists to remove.
   */
  const [turning, setTurning] = useState<{
    row: DriverDocumentRow
    file: File
  } | null>(null)
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
  /** Fetch the card, then open the dialog on it. */
  const open = async (row: DriverDocumentRow) => {
    // REFUSED BEFORE THE PERSON IS ASKED TO TURN ANYTHING. `storeRotatedAndRead`
    // refuses an unreadable type too, and this is not a duplicate of it: that
    // one guards the money, this one guards somebody's time. Being asked to
    // turn a card and only then told it cannot be read is a worse answer than
    // being told first.
    if (!READABLE_TYPES.has(row.type)) {
      setNotice(`${labels.readFailed} (type)`)
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const fetched = await fetchDocumentFile(row.id, {})
      if (!fetched.ok) {
        setNotice(`${labels.readFailed} (${fetched.step})`)
        return
      }
      setTurning({ row, file: fetched.file })
    } catch {
      setNotice(labels.readFailed)
    } finally {
      setBusy(false)
    }
  }

  const run = async (
    document: DriverDocumentRow,
    file: File,
    quarterTurns: number,
  ) => {
    setTurning(null)
    setBusy(true)
    setNotice(null)
    try {
      const outcome = await storeRotatedAndRead(
        file,
        {
          documentId: document.id,
          driverId,
          // FROM THE ORIGINAL. Hard-coding this was an unstated assumption
          // that only medical cards are ever parked.
          documentType: document.type,
          quarterTurns,
          readRoute: '/api/med/read',
        },
        {
          rotate: (image, turns) =>
            downscaleImage(image, { quarterTurns: turns }),
          upload: (image, target) => uploadDocument(image, target),
        },
      )
      // NAMED BY STEP. "It did not work" sends somebody to photograph the card
      // again, which is the trip this whole feature exists to save.
      setNotice(
        outcome.ok ? labels.readOk : `${labels.readFailed} (${outcome.step})`,
      )
      // The turned copy and its reading are rows now; the list shows them
      // without a reload (rule 15).
      if (outcome.ok) router.refresh()
    } catch {
      setNotice(labels.readFailed)
    } finally {
      setBusy(false)
    }
  }

  if (turning) {
    return (
      <UprightCard
        file={turning.file}
        labels={labels.upright}
        onConfirm={(quarterTurns) =>
          void run(turning.row, turning.file, quarterTurns)
        }
        onCancel={() => setTurning(null)}
      />
    )
  }

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>

      {/* UPLOAD, BY KIND, ON THE DRIVER. The kind is chosen first and the
       * file second, so nothing lands as "other" by accident. */}
      {mayUpload ? (
        <div className="mt-z3 flex flex-wrap items-end gap-z3">
          <div className="min-w-[220px]">
            <Select
              name="kind"
              label={labels.kind}
              options={kinds}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            />
          </div>
          <span className="pb-z2">
            <UploadTo
              key={kind}
              target={{
                entity: 'driver',
                entityId: driverId,
                documentType: kind,
              }}
              labels={labels.upload}
            />
          </span>
        </div>
      ) : null}

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
              <span className="min-w-[16ch] text-ink-2">
                {kindLabels[document.type] ?? document.type}
              </span>
              <DocumentLink
                id={document.id}
                filename={document.filename}
                failedLabel={labels.open}
              />
              <span className="font-mono text-xs text-ink-3">
                {labels.uploaded} {day(document.uploadedAt)}
              </span>
              {/* AN EXPIRY ONLY WHERE THERE IS ONE. A dash would read as a
               * missing date on a document that has none to miss. */}
              {document.expiresAt ? (
                <span className="font-mono text-xs text-ink-2">
                  {labels.expires} {day(document.expiresAt)}
                </span>
              ) : null}
              {/* SAID IN WORDS, NOT SHOWN AS AN ABSENCE. A row that simply
               * lacked a green tick would read as "fine" at a glance, and the
               * whole point of keeping this file is that somebody has to do
               * something about it. */}
              {/* SUPERSEDED WINS OVER NEEDS-ROTATION. Both are true of a
               * card somebody has already turned and read — it was never read
               * itself, and there is now a copy that was — and showing the
               * warning as well would be the list nagging about finished
               * work. */}
              {document.superseded ? (
                <span className="text-xs text-ink-3">{labels.superseded}</span>
              ) : document.needsRotation ? (
                <span className="rounded-card border border-warning bg-warning-soft px-z2 py-px text-xs text-warning">
                  {labels.needsRotation}
                </span>
              ) : null}
              {/* ONLY ON THE ROWS THAT NEED IT, and only for somebody who may
               * file compliance — reading a card to propose a record they
               * cannot create is work done for a refusal. */}
              {document.needsRotation && !document.superseded && mayRead ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void open(document)}
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
