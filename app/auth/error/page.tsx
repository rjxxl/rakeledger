export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const error = sp.error ?? "Unknown";
  const message =
    error === "AccessDenied"
      ? "Your Google account isn't authorized to access this RakeLedger deployment. Contact the cardroom owner to be added."
      : `Sign-in failed: ${error}.`;

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-white flex items-center justify-center p-4">
      <div className="bg-[var(--color-panel)] border border-red-900 rounded-lg p-8 w-full max-w-sm">
        <h1 className="text-red-400 font-semibold text-lg mb-2">Sign-in problem</h1>
        <p className="text-sm text-slate-300 mb-4">{message}</p>
        <a href="/auth/signin" className="text-amber-500 hover:underline text-sm">
          Try again
        </a>
      </div>
    </div>
  );
}
