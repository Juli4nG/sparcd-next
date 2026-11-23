import { useRef } from 'react';
import { Connection } from '../Connection';
import { loadPersistedConnection, saveSharedConnection } from '../session';
import { S3Error, signIn, type Config, type Session } from '@sparcd/bucket';

/** The Field Notebook sign-in, checked against the gate's /-/whoami. */
export function GateSignIn({
  config,
  toolName,
  onSignedIn,
}: {
  config: Config;
  toolName: string;
  onSignedIn: (s: Session) => void;
}) {
  const session = useRef<Session>();
  return (
    <Connection
      gate
      toolName={toolName}
      initialConfig={{ accessKey: loadPersistedConnection()?.accessKey }}
      onTestConnection={async (c) => {
        try {
          session.current = await signIn(config, c.accessKey, c.secretKey);
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            category: err instanceof S3Error && err.status === 403 ? 'credentials-rejected' : 'unreachable',
          };
        }
      }}
      onConnect={(c, remember) => {
        saveSharedConnection(c, remember);
        onSignedIn(session.current!);
      }}
    />
  );
}
