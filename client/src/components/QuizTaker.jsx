import { useState, useMemo, useRef } from "react";
import { ChevronLeft, Check, X, RotateCcw, Award } from "lucide-react";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export default function QuizTaker({ quiz, onExit }) {
  const mcqs = quiz.mcqs || [];

  const [choice, setChoice]       = useState({}); // qIndex -> optionIndex
  const [submitted, setSubmitted] = useState(false);
  const topRef = useRef(null);

  const answered = Object.keys(choice).length;
  const correct = useMemo(
    () => mcqs.reduce((acc, q, i) => acc + (choice[i] === q.correctIndex ? 1 : 0), 0),
    [mcqs, choice]
  );

  const total = mcqs.length;
  const pct = total ? Math.round((correct / total) * 100) : 0;

  function handleSubmit() {
    setSubmitted(true);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function handleRetake() {
    setChoice({});
    setSubmitted(false);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const tone = pct >= 80 ? "good" : pct >= 50 ? "ok" : "low";
  const msg =
    pct >= 80 ? "Excellent — you really know this!"
    : pct >= 50 ? "Good effort — review the misses and go again."
    : "Keep studying — retake it once you've reviewed.";

  return (
    <div className="quiz-taker">
      <div className="quiz-taker__top" ref={topRef}>
        <button className="quiz-back" onClick={onExit}>
          <ChevronLeft size={16} /> Back to quizzes
        </button>
        <div className="quiz-taker__title">{quiz.noteName}</div>
        <div className="quiz-taker__meta">{mcqs.length} multiple-choice question{mcqs.length === 1 ? "" : "s"}</div>
      </div>

      {/* Score card (after submit) */}
      {submitted && (
        <div className={`quiz-result quiz-result--${tone}`}>
          <div className="quiz-result__icon"><Award size={26} /></div>
          <div className="quiz-result__body">
            <div className="quiz-result__score">{correct} / {total} <span>({pct}%)</span></div>
            <div className="quiz-result__msg">{msg}</div>
          </div>
          <button className="quiz-btn quiz-btn--ghost" onClick={handleRetake}>
            <RotateCcw size={14} /> Retake
          </button>
        </div>
      )}

      <section className="quiz-section">
        <ol className="quiz-qlist">
          {mcqs.map((q, i) => {
            const chosen = choice[i];
            const isCorrect = submitted && chosen === q.correctIndex;
            const isWrong = submitted && chosen != null && chosen !== q.correctIndex;
            return (
              <li className="quiz-q" key={i}>
                <div className="quiz-q__text">{q.question}</div>
                <div className="quiz-options">
                  {q.options.map((opt, oi) => {
                    const selected = chosen === oi;
                    const showCorrect = submitted && oi === q.correctIndex;
                    const showWrong = submitted && selected && oi !== q.correctIndex;
                    const cls = [
                      "quiz-option",
                      selected ? "quiz-option--selected" : "",
                      showCorrect ? "quiz-option--correct" : "",
                      showWrong ? "quiz-option--wrong" : "",
                    ].filter(Boolean).join(" ");
                    return (
                      <button
                        type="button"
                        key={oi}
                        className={cls}
                        disabled={submitted}
                        onClick={() => setChoice((p) => ({ ...p, [i]: oi }))}
                      >
                        <span className="quiz-option__letter">{LETTERS[oi]}</span>
                        <span className="quiz-option__text">{opt}</span>
                        {showCorrect && <Check size={16} className="quiz-option__mark" />}
                        {showWrong && <X size={16} className="quiz-option__mark" />}
                      </button>
                    );
                  })}
                </div>
                {submitted && (
                  <div className={`quiz-q__feedback ${isCorrect ? "is-correct" : isWrong ? "is-wrong" : "is-skipped"}`}>
                    {isCorrect ? "Correct."
                      : isWrong ? `Incorrect — the answer is ${LETTERS[q.correctIndex]}.`
                      : `Skipped — the answer is ${LETTERS[q.correctIndex]}.`}
                    {q.explanation && <span className="quiz-q__why"> {q.explanation}</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Footer actions */}
      <div className="quiz-taker__actions">
        {!submitted ? (
          <>
            <span className="quiz-progress">{answered}/{mcqs.length} answered</span>
            <button className="quiz-btn quiz-btn--primary" onClick={handleSubmit}>
              Submit &amp; score
            </button>
          </>
        ) : (
          <>
            <button className="quiz-btn quiz-btn--ghost" onClick={handleRetake}>
              <RotateCcw size={14} /> Retake
            </button>
            <button className="quiz-btn quiz-btn--primary" onClick={onExit}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
