export default function Page() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        pcb-copilot
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Project scaffolded. Circuit generation and viewers are not wired up yet.
      </p>
    </main>
  )
}
