import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
//  StatusTask — Durable Background Job Record
//
//  Every authorized status@broadcast that enters the heavy processing pipeline
//  (downloadMediaMessage → Sharp → Cloudinary → FlashStatus → Resend email)
//  gets a 'pending' document written here BEFORE any async work begins.
//
//  If PM2 kills the process mid-upload, resumeDroppedTasks() (called on
//  connection === 'open') queries for 'pending' documents and re-fires the
//  pipeline using the saved payload — guaranteeing at-least-once delivery.
// ─────────────────────────────────────────────────────────────────────────────
const statusTaskSchema = new mongoose.Schema(
  {
    // Stable dedup key: "<senderJid>_<messageTimestamp>"
    // Used by the dedup Set AND as an idempotency guard in resumeDroppedTasks.
    messageId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    // Full JID of the status author (e.g. "254712345678@s.whatsapp.net")
    authorJid: {
      type:     String,
      required: true,
    },

    // Lifecycle state of the background job
    status: {
      type:    String,
      enum:    ['pending', 'completed', 'failed'],
      default: 'pending',
      index:   true,   // indexed so the recovery query is O(log n)
    },

    // All data needed to re-run the pipeline on recovery, stored as-is.
    // Includes the Baileys message object snapshot + resolved caption.
    // NOTE: rawBuffer cannot be stored in Mongo — the recovery path
    // re-downloads it from WhatsApp using the saved message snapshot.
    payload: {
      type:     mongoose.Schema.Types.Mixed,
      required: true,
    },

    // Optional human-readable failure reason (populated on catch)
    failureReason: {
      type:    String,
      default: null,
    },

    // How many times the pipeline has been attempted (initial + retries)
    attempts: {
      type:    Number,
      default: 1,
    },

    // Timestamp when the task last transitioned state
    resolvedAt: {
      type:    Date,
      default: null,
    },
  },
  {
    // Adds createdAt + updatedAt automatically
    timestamps: true,
  }
);

// TTL index: auto-delete completed/failed tasks after 7 days to keep the
// collection lean. PM2-killed pending tasks are recovered within seconds,
// so 7 days of retention is more than enough for auditing.
statusTaskSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 }  // 604800 seconds
);

const StatusTask = mongoose.model('StatusTask', statusTaskSchema);

export default StatusTask;
