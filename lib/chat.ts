export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'status'
  content: string
  tone?: 'info' | 'success' | 'error'
}
