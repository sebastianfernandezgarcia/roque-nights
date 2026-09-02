#!/usr/bin/env python3
"""Build the voice-over track for the Roque Nights video from the sentence recordings.

Input : FrasesGrabadas/*.mov (21 OBS recordings, one sentence each, in order)
Output: video/public/voice.mp3          the narration placed on the final timeline
        video/public/voice.json         [{ id, scene, text, startSec, endSec }] for burned-in subtitles
        video/public/scene-plan.json    scene durations and the VO anchors the editor aligns clips to

Speech bounds come from ffmpeg silencedetect (-38 dB, 0.25 s). Sentence 13 is split at its
natural pause so "describe_current_view" lands on that tool call and "a ghost plan" on the
proposal appearing. Nothing is sped up: gaps are 0.5 s, each scene gets a little air.
"""
import json, os, subprocess, sys, wave, struct

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'FrasesGrabadas')
OUT = os.path.join(ROOT, 'video', 'public')
TMP = os.path.join(ROOT, 'video', '.voice-tmp')
os.makedirs(TMP, exist_ok=True)
SR = 48000

# id -> (file index 1..21, speech start s, speech end s, text)   bounds from silencedetect, see docs/video/voice-notes
SENTENCES = [
    ('01', 1, 2.36, 11.36, "Hi, I'm Sebastián. I'm an AI engineer at the Gran Telescopio Canarias, the largest optical telescope in the world, here on La Palma."),
    ('02', 2, 1.04, 3.97, "This is one of the best night skies on Earth."),
    ('03', 3, 1.25, 5.55, "And planning a good night under it is still surprisingly hard."),
    ('04', 4, 1.05, 7.89, "This is Roque Nights: an observing planner where you and your AI agent share the same instrument."),
    ('05', 5, 1.14, 6.24, "Not an API behind a page. One live sky map, two operators."),
    ('06', 6, 1.29, 11.03, "I open it in ChatGPT's browser, and the app registers fifteen WebMCP tools, eleven always live, right here in the page."),
    ('07', 7, 1.16, 8.44, "I paste one prompt: plan me a three-hour night, best night in the next two weeks, avoiding the Moon."),
    ('08', 8, 1.24, 9.83, "Watch the panel. The agent ranks the nights and picks September 13th: new Moon, nine hours of darkness."),
    ('09', 9, 1.91, 7.82, "And the sky map moves. The agent is pointing the dome at each target while I watch."),
    ('10', 10, 1.05, 3.35, "Now, the part I care about."),
    ('11', 11, 0.95, 9.08, "I tap the sky and mark Andromeda and the Pleiades as my favorites. No typing, just a gesture on the map."),
    ('12', 12, 1.19, 4.49, "I ask the agent to adjust the plan around my favorites."),
    ('13a', 13, 1.02, 4.04, "It reads my gesture through describe_current_view"),
    ('13b', 13, 4.53, 7.34, "and proposes a new plan: a ghost plan."),
    ('14', 14, 0.83, 6.42, "Nothing is committed until I say so. I review it item by item, and confirm."),
    ('15', 15, 1.42, 9.46, "And best of all, the plan is portable. I switch the site to Mauna Kea, Hawaii: a very different telescope."),
    ('16', 16, 0.97, 6.15, "The app flags it immediately: this plan was built for a different sky."),
    ('17', 17, 0.91, 12.94, "The agent revalidates it, four kept, four moved, and I export it: JSON, calendar, or a shared link that carries the whole plan."),
    ('18', 18, 0.98, 7.66, "Everything runs in the browser. Zero servers. All the astronomy computed locally."),
    ('19', 19, 1.04, 8.70, "WebMCP made this possible: the agent doesn't scrape my interface. It uses the same instrument I do."),
    ('20', 20, 0.56, 5.31, "So this is Roque Nights. Plan the sky with your agent."),
    ('21', 21, 1.11, 6.74, "Open source, live now, and built from the Roque de los Muchachos, La Palma."),
]
HEAD, TAIL = 0.12, 0.22          # padding kept around each sentence (natural breath)
GAP = 0.5                        # silence between sentences inside a scene

# scenes: id, sentences, air before the first sentence, air after the last one
SCENES = [
    ('coldOpen',    ['01', '02', '03'],        1.4, 0.8),
    ('title',       ['04', '05'],              0.6, 0.9),
    ('onboarding',  ['06', '07'],              0.5, 0.9),
    ('agentPoints', ['08', '09'],              0.5, 1.4),
    ('favorites',   ['10', '11', '12', '13a'], 0.5, 0.4),
    ('ghostPlan',   ['13b', '14'],             0.3, 3.2),
    ('anotherSky',  ['15', '16', '17'],        0.5, 1.2),
    ('closingDome', ['18', '19'],              0.8, 1.4),
    ('outro',       ['20', '21'],              0.9, 3.0),
]

def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

files = sorted(f for f in os.listdir(SRC) if f.lower().endswith('.mov'))
assert len(files) == 21, f'expected 21 recordings, found {len(files)}'

# 1. cut every sentence to a 48 kHz mono wav
cuts = {}
for sid, idx, s, e, _ in SENTENCES:
    src = os.path.join(SRC, files[idx - 1])
    dst = os.path.join(TMP, f'{sid}.wav')
    start = max(0.0, s - HEAD)
    run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{start:.3f}', '-to', f'{e + TAIL:.3f}', '-i', src,
         '-vn', '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_s16le',
         '-af', 'afade=t=in:d=0.04,afade=t=out:st=%.3f:d=0.08' % max(0, (e + TAIL) - start - 0.08), dst])
    with wave.open(dst) as w:
        cuts[sid] = w.readframes(w.getnframes())

def dur(sid):
    return len(cuts[sid]) / 2 / SR

# 2. lay the sentences on the timeline scene by scene
t = 0.0
voice, plan = [], []
text_by_id = {s[0]: s[4] for s in SENTENCES}
for scene, ids, air_before, air_after in SCENES:
    scene_start = t
    t += air_before
    anchors = []
    for k, sid in enumerate(ids):
        if k: t += GAP
        start = t
        end = t + dur(sid)
        voice.append({'id': sid, 'scene': scene, 'text': text_by_id[sid], 'startSec': round(start, 3), 'endSec': round(end, 3)})
        anchors.append({'sentence': sid, 'startSec': round(start - scene_start, 3), 'endSec': round(end - scene_start, 3)})
        t = end
    t += air_after
    plan.append({'scene': scene, 'startSec': round(scene_start, 3), 'durationSec': round(t - scene_start, 3), 'anchors': anchors})
total = t

# 3. render the track: silence + cuts, then loudness-normalise and encode
raw = os.path.join(TMP, 'voice-raw.wav')
with wave.open(raw, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    cursor = 0
    for v in voice:
        start_frame = int(round(v['startSec'] * SR))
        if start_frame > cursor:
            w.writeframes(b'\x00\x00' * (start_frame - cursor)); cursor = start_frame
        data = cuts[v['id']]
        w.writeframes(data); cursor += len(data) // 2
    end_frame = int(round(total * SR))
    if end_frame > cursor:
        w.writeframes(b'\x00\x00' * (end_frame - cursor))

os.makedirs(OUT, exist_ok=True)
run(['ffmpeg', '-y', '-v', 'error', '-i', raw,
     '-af', 'highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11',
     '-c:a', 'libmp3lame', '-b:a', '192k', os.path.join(OUT, 'voice.mp3')])

with open(os.path.join(OUT, 'voice.json'), 'w') as f:
    json.dump(voice, f, indent=1, ensure_ascii=False)
with open(os.path.join(OUT, 'scene-plan.json'), 'w') as f:
    json.dump({'totalSec': round(total, 3), 'gapSec': GAP, 'scenes': plan}, f, indent=1)

print(f'voice: {len(voice)} cues, {total:.1f} s total')
for p in plan:
    print(f"  {p['scene']:<12} {p['startSec']:7.2f}  +{p['durationSec']:5.2f}  " + ' '.join(f"{a['sentence']}@{a['startSec']}" for a in p['anchors']))
