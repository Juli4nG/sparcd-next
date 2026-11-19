import { useEffect, useState } from 'react';
import type { About, Session, Species } from '@sparcd/bucket';
import { Message } from '../App';
import { loadSettings, type Card } from '../data/card';
import { BROKEN_LINK, LinkGone, loadShareCard, rememberLink } from '../data/share';
import { cardTitle } from '../dates';
import { SimpleTag } from '../simple/Simple';
import { Tag } from '../tag/Tag';

/** A card someone shared, in the usual tagging screen; tags save to the person's own photos. */
export function SharePage({ session, url, endpoint, simple }: { session: Session; url: string; endpoint: string; simple: boolean }) {
  const [state, setState] = useState<{ card: Card; about: About; species: Species[] } | 'gone' | 'failed' | null>(null);
  useEffect(() => {
    loadShareCard(session, url, endpoint).then(async (card) => [await loadSettings(session), card] as const).then(
      ([settings, card]) => {
        rememberLink(card, url);
        setState({ ...settings, card });
      },
      (err) => setState(err instanceof LinkGone ? 'gone' : 'failed'),
    );
  }, [session, url, endpoint]);

  if (!state) return <Message>Loading the photos…</Message>;
  if (state === 'gone') return <Message warn>{BROKEN_LINK}</Message>;
  if (state === 'failed') return <Message warn>We couldn't reach the server. Check your internet connection, then reload the page.</Message>;
  const Screen = simple ? SimpleTag : Tag;
  return <Screen session={session} about={state.about} species={state.species} card={state.card} title={cardTitle(state.card.deployment)} />;
}
