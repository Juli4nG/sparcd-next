import { Dialog, DialogHeader } from '../ui/Dialog';

type Shortcut = { keys: string[]; action: string };

const GROUPS: { title: string; rows: Shortcut[] }[] = [
  {
    title: 'Move around',
    rows: [
      { keys: ['↓', '→'], action: 'Next photo' },
      { keys: ['↑', '←'], action: 'Previous photo' },
      { keys: ['Enter'], action: 'Open the photo large' },
      { keys: ['Esc'], action: 'Close the large photo' },
    ],
  },
  {
    title: 'Tag',
    rows: [
      { keys: ['letter'], action: 'Add the species on that key' },
      { keys: ['2', 'letter'], action: 'Type a number first to set how many' },
      { keys: ['Shift', 'Ctrl'], action: 'When given to a species: tap alone and let go' },
      { keys: ['Space'], action: 'Search species' },
      { keys: ['Enter'], action: 'In the search: add the top species' },
    ],
  },
  {
    title: 'Choose & undo',
    rows: [
      { keys: ['Shift', 'click'], action: 'Choose a run of photos' },
      { keys: ['Ctrl', 'click'], action: 'Add or remove one photo' },
      { keys: ['Ctrl', 'A'], action: 'Choose the photos taken with this one (within a minute of each other)' },
      { keys: ['Esc'], action: 'Clear the chosen photos' },
      { keys: ['Ctrl', 'Z'], action: 'Undo the last change' },
      { keys: ['?'], action: 'Show this list' },
    ],
  },
];

export function Cheatsheet({ onClose }: { onClose: () => void }) {
  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose} wide>
      <DialogHeader title="Keyboard shortcuts" onClose={onClose} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4 p-5">
        {GROUPS.map((g) => (
          <section key={g.title} className="min-w-0">
            <h3 className="font-body text-[13px] font-[600] tracking-[0.12em] uppercase text-inkSoft mb-2">{g.title}</h3>
            <ul className="space-y-2">
              {g.rows.map((r) => (
                <li key={r.action} className="text-[13px]">
                  <span className="inline-flex gap-1 mr-2 align-middle">
                    {r.keys.map((k) => (
                      <kbd key={k} className="px-1.5 min-w-6 h-6 grid place-items-center border border-ink text-[13px] font-mono text-ink">
                        {k}
                      </kbd>
                    ))}
                  </span>
                  <span className="text-inkSoft">{r.action}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
