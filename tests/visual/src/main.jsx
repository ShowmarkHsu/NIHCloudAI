import React from 'react';
import {createRoot} from 'react-dom/client';

import {installChromeMock} from './chromeMock.js';
import {installFixture, installFixedClock} from './fixtureAdapter.js';
import './harness.css';

const query = new URLSearchParams(window.location.search);
const fixtureId = query.get('fixture') || 'full-spectrum';
const variantId = query.get('variant') || 'default';
const settingsFixtureId = query.get('settingsFixture') || fixtureId;
const surface = query.get('surface') || 'floating';
const installed = installFixture(fixtureId, variantId, settingsFixtureId);

installFixedClock(installed.fixture.clock.now);
installChromeMock(installed.settings, installed.sourceStates);

const root = createRoot(document.getElementById('root'));
if (surface === 'popup') {
  const {default: PopupSettings} = await import('../../../src/components/PopupSettings.jsx');
  root.render(<main className="popup-shell" aria-label="合成設定頁面"><PopupSettings /></main>);
} else {
  const {default: FloatingIcon} = await import('../../../src/components/FloatingIcon.jsx');
  root.render(<main className="synthetic-host" aria-label="合成健保雲端頁面"><FloatingIcon /></main>);
}

window.__visualHarness = {
  fixtureId,
  variantId,
  surface,
  synthetic: true,
  fixedNow: installed.fixture.clock.now,
  sourceStates: installed.sourceStates,
  activeSessionId: installed.replay.activeSessionId,
  activePatientKey: installed.replay.activePatientKey,
  acceptedEventSeq: installed.replay.acceptedSeq,
  rejectedEventSeq: installed.replay.rejectedSeq,
};
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
document.body.dataset.harnessReady = 'true';
