import { signIn } from "@/lib/auth";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-white flex items-center justify-center p-4">
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-8 w-full max-w-sm">
        <div className="text-amber-500 font-bold text-2xl mb-2 text-center">♠ RakeLedger</div>
        <p className="text-sm text-slate-400 text-center mb-6">
          Sign in with the Google account associated with your cardroom.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: sp.callbackUrl ?? "/live" });
          }}
        >
          <button
            type="submit"
            className="w-full bg-amber-500 text-black font-semibold rounded px-4 py-3 hover:bg-amber-400"
          >
            Sign in with Google
          </button>
        </form>
        <p className="text-xs text-slate-500 mt-4 text-center">
          Only authorized accounts can sign in. If you can&apos;t access the app, contact your cardroom owner.
        </p>
      </div>
    </div>
  );
}
