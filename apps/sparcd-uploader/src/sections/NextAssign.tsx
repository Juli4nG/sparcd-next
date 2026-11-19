// The Describe step on the new storage: a site from the lab's sites.csv and the
// date the card came out of the camera. Collection, uploader identity, time
// zone and upload comments have no place in a person's own bucket, so they're
// left out; Assign.tsx keeps the old screen.
import { useMemo } from 'react';
import { InfoTooltip } from '../components/InfoTooltip';
import { DeploymentPicker } from '../components/DeploymentPicker';
import { findAllowedLocation } from '../lib/allowedLocations';
import type { Location } from '../lib/locations';
import { useStore } from '../store';
import { useNext } from '../next/session';
import type { Site } from '@sparcd/bucket';

export const siteLocation = (s: Site): Location => ({
  key: s.locationID,
  id: s.locationID,
  name: s.locationName,
  latitude: s.latitude,
  longitude: s.longitude,
  elevation: NaN,
});

function LocationsState({ message, tone }: { message: string; tone: 'mute' | 'warn' }) {
  return (
    <div
      className={`border px-3 py-2.5 font-body text-[13px] ${
        tone === 'warn' ? 'border-warn/40 text-warn bg-paper' : 'border-ruleSoft text-inkSoft bg-paper'
      }`}
    >
      {message}
    </div>
  );
}

export function NextAssign() {
  const setStep = useStore((s) => s.setStep);
  const selectedLocationId = useStore((s) => s.selectedLocationId);
  const setSelectedLocationId = useStore((s) => s.setSelectedLocationId);
  const dateCollected = useStore((s) => s.dateCollected);
  const setDateCollected = useStore((s) => s.setDateCollected);
  const elevationUnit = useStore((s) => s.elevationUnit);
  const sites = useNext((s) => s.sites);
  const settingsError = useNext((s) => s.settingsError);

  const locations = useMemo(() => (sites ?? []).map(siteLocation), [sites]);
  const location = findAllowedLocation(locations, selectedLocationId);
  const ready = !!location && !!dateCollected;
  const continueHint = !location
    ? 'Select a deployment location first'
    : !dateCollected
      ? 'Enter a date collected before continuing'
      : null;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <section>
        <span className="inline-flex items-center gap-1.5 mb-2">
          <h2 className="font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft">Site ID (required)</h2>
          <InfoTooltip
            label="Site ID"
            text="Choose the Site ID for the location where this batch's images were collected."
          />
        </span>
        {settingsError && <LocationsState tone="warn" message={settingsError} />}
        {!sites && !settingsError && <LocationsState tone="mute" message="Loading the lab's sites…" />}
        {sites && (
          <div className="space-y-2">
            {locations.length === 0 ? (
              <LocationsState tone="warn" message="No sites are set up for this lab yet." />
            ) : (
              <DeploymentPicker
                locations={locations}
                value={selectedLocationId}
                onChange={setSelectedLocationId}
                elevationUnit={elevationUnit}
              />
            )}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-1.5 mb-2">
          <label htmlFor="dateCollected" className="font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft">
            Date collected (required)
          </label>
          <InfoTooltip label="Date collected" text="The date these images were collected in the field." />
        </div>
        <input
          id="dateCollected"
          required
          aria-describedby="date-collected-help"
          type="date"
          value={dateCollected}
          onChange={(e) => setDateCollected(e.target.value)}
          className="w-full border border-rule bg-paper px-3 py-2 font-body text-[14px] text-ink mb-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        />
        <p id="date-collected-help" className="font-body text-[12px] text-inkMute mb-4">
          The day the card came out of the camera.
        </p>
      </section>

      {!ready && continueHint && (
        <p id="upload-continue-help" role="status" className="font-body text-[12px] text-warn">
          {continueHint}
        </p>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-ruleSoft pt-5">
        <button
          onClick={() => setStep('inspect')}
          className="border border-ink text-ink px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          Back
        </button>
        <button
          disabled={!ready}
          onClick={() => ready && setStep('upload')}
          aria-describedby={!ready ? 'upload-continue-help' : undefined}
          title={continueHint ?? 'Continue to upload'}
          className={`bg-ink text-paper border border-ink px-3.5 py-1.5 text-[14px] font-body font-[600] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
            ready ? 'hover:opacity-90' : 'opacity-40 cursor-not-allowed'
          }`}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
