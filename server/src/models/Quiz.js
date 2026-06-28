import mongoose from "mongoose";

// One multiple-choice question: 2-6 options, with the index of the right one.
const mcqSchema = new mongoose.Schema(
  {
    question:     { type: String, required: true },
    options:      { type: [String], required: true },
    correctIndex: { type: Number, required: true },
    explanation:  { type: String, default: "" },
  },
  { _id: false }
);

// One short-answer question with a concise model answer.
const saqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    answer:   { type: String, required: true },
  },
  { _id: false }
);

// One quiz per note per user. Regenerating replaces it (upsert);
// "add more" appends to the existing arrays.
const quizSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    noteId:    { type: mongoose.Schema.Types.ObjectId, ref: "Note", required: true },
    noteName:  { type: String, required: true },
    mcqs:      { type: [mcqSchema], default: [] },
    saqs:      { type: [saqSchema], default: [] },
    model:     { type: String },
    truncated: { type: Boolean, default: false }, // source text was too long to send in full
  },
  { timestamps: true }
);

quizSchema.index({ userId: 1, noteId: 1 }, { unique: true });

export const Quiz = mongoose.model("Quiz", quizSchema);
