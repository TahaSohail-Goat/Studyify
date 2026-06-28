const API_URL = "http://localhost:5000";

function getToken() {
  return localStorage.getItem("token");
}

async function request(urlPath, options = {}) {
  const res = await fetch(`${API_URL}${urlPath}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}

// All quizzes the user has generated.
export function getQuizzesApi() {
  return request("/api/quizzes");
}

// Generate (or regenerate) a quiz for one file.
// payload: { types: ["mcq","saq"], mcqCount, saqCount }
export function generateQuizApi(noteId, payload) {
  return request(`/api/quizzes/${noteId}/generate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Append more questions of one kind to an existing quiz.
export function addQuizQuestionsApi(noteId, kind, count) {
  return request(`/api/quizzes/${noteId}/more`, {
    method: "POST",
    body: JSON.stringify({ kind, count }),
  });
}

export function deleteQuizApi(id) {
  return request(`/api/quizzes/${id}`, { method: "DELETE" });
}
