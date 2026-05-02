# Chat API Contract

Multi-turn tutoring chat endpoint. The server is stateless — the client owns the conversation history and sends the full `messages` array on every request.

---

## `POST /api/chat`

### Request body

```json
{
  "domain": "optimization",
  "unitIds": [3, 7],
  "messages": [
    { "role": "user", "content": "Can you explain what this question is asking?" },
    { "role": "assistant", "content": "Sure! This question is about..." },
    { "role": "user", "content": "Can you give me a concrete example?" }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `domain` | `string` | yes | Domain identifier (e.g. `"optimization"`) — same value used in `/api/test/generate` |
| `unitIds` | `number[]` | yes | Unit IDs relevant to the session — pass the same ones used to generate the test |
| `messages` | `object[]` | yes | Full conversation history. Must be non-empty. Last entry must have `role: "user"` |

Each message object:

| Field | Type | Values |
|---|---|---|
| `role` | `string` | `"user"` or `"assistant"` |
| `content` | `string` | Message text |

### Response — 200 OK

```json
{
  "role": "assistant",
  "reply": "Here's a concrete example..."
}
```

Append `{ role: "assistant", content: data.reply }` to your local messages array and render it.

### Response — 400 Bad Request

```json
{ "error": "domain and unitIds[] required" }
```

Possible error strings:
- `"domain and unitIds[] required"`
- `"messages[] required"`
- `"last message must have role \"user\""`

### Response — 500 Internal Server Error

```json
{ "error": "..." }
```

AI provider failure or prompt compilation error. Display an error state; user can retry.

---

## Frontend Integration Pattern

### Opening a chat from a test question

When the user clicks **Learn** on a question, open the chat page and seed the first message with the question text:

```js
const initialMessages = [
  {
    role: 'user',
    content: `${question.text}\n\nCan you explain the concepts behind this question from the ground up?`
  }
];
```

Pass `domain` and `unitIds` from the test session state — they are already available from the `/api/test/generate` call.

### Sending a turn

```js
async function sendMessage(userText) {
  const nextMessages = [...messages, { role: 'user', content: userText }];
  setMessages(nextMessages); // optimistic update

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, unitIds, messages: nextMessages }),
  });

  const data = await res.json();
  if (!res.ok) { /* show error */ return; }

  setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
}
```

**Always send the full `messages` array — never just the latest message.** The server builds context from the entire history each time.

### State shape

```js
{
  domain: string,         // from test session
  unitIds: number[],      // from test session
  messages: [             // grows with each turn
    { role: 'user' | 'assistant', content: string }
  ],
  loading: boolean
}
```
