import { useEffect, useState } from 'react';
import type { About, Session, Species } from '@sparcd/bucket';
import { Message } from '../App';
import { loadSettings, type Card } from '../data/card';
import { LinkGone, loadShareCard, rememberLink } from '../data/share';
import { cardTitle } from '../dates';
import { Tag } from '../tag/Tag';

export const EXPIRED = 'This link has expired. Ask the person who sent it for a new one.';

/** A card someone shared, in the usual tagging screen; tags save to the person's own photos. */
export function SharePage({ session, url }: { session: Session; url: string }) {
  const [state, setState] = useState<{ card: Card; about: About; species: Species[] } | 'gone' | 'failed' | null>(null);
  useEffect(() => {
    Promise.all([loadSettings(session), loadShareCard(session, url)]).then(
      ([settings, card]) => {
        rememberLink(card, url);
        setState({ ...settings, card });
      },
      (err) => setState(err instanceof LinkGone ? 'gone' : 'failed'),
    );
  }, [session, url]);

  if (!state) return <Message>Loading the photos…</Message>;
  if (state === 'gone') return <Message warn>{EXPIRED}</Message>;
  if (state === 'failed') return <Message warn>We couldn't open this card. Check your internet connection, then reload the page.</Message>;
  return <Tag session={session} about={state.about} species={state.species} card={state.card} title={cardTitle(state.card.deployment)} />;
}
