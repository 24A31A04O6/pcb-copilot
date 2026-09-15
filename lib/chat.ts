export type ChatMessage = {
  id: string
  role: 'user' | 'status'
  content: string
  tone?: 'info' | 'success' | 'error'
}
