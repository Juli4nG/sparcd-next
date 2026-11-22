export const focusRing = 'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent';
export const press = 'transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none';
export const bigPrimary = `inline-flex items-center justify-center h-16 px-8 bg-ink text-paper border-2 border-ink text-[22px] font-[600] hover:opacity-90 disabled:opacity-40 ${press} ${focusRing}`;
export const bigSecondary = `inline-flex items-center justify-center h-16 px-8 bg-panel text-ink border-2 border-ink text-[22px] font-[600] hover:bg-paperHover ${press} ${focusRing}`;
export const quietLink = `inline-flex items-center min-h-12 text-[20px] text-accent underline underline-offset-4 ${focusRing}`;
