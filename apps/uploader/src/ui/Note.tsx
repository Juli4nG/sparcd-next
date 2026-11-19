export function Note({ message, tone = 'mute' }: { message: string; tone?: 'mute' | 'warn' }) {
  return (
    <div
      role={tone === 'warn' ? 'alert' : undefined}
      className={`border px-3 py-2.5 font-body text-[13px] ${
        tone === 'warn' ? 'border-warn/40 text-warn bg-paper' : 'border-ruleSoft text-inkSoft bg-paper'
      }`}
    >
      {message}
    </div>
  );
}
