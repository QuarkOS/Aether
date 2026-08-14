import { useEffect, useState } from "react";
import type { AssistantState, Emotion } from "@aether/shared";

interface Props {
  emotion: Emotion;
  mouthOpen: number;
  gaze: { x: number; y: number };
  state: AssistantState;
}

interface FaceParams {
  browAngle: number;
  browY: number;
  eyeOpen: number;
  mouthCurve: number;
  blush: number;
}

function faceFor(emotion: Emotion): FaceParams {
  switch (emotion) {
    case "happy":
      return { browAngle: -6, browY: 0, eyeOpen: 0.85, mouthCurve: 10, blush: 0.2 };
    case "smug":
      return { browAngle: -10, browY: -1, eyeOpen: 0.7, mouthCurve: 6, blush: 0 };
    case "shy":
      return { browAngle: 8, browY: 1, eyeOpen: 0.75, mouthCurve: 3, blush: 0.85 };
    case "embarrassed":
      return { browAngle: 12, browY: 2, eyeOpen: 0.6, mouthCurve: -2, blush: 1 };
    case "angry":
      return { browAngle: 20, browY: -2, eyeOpen: 0.9, mouthCurve: -8, blush: 0.1 };
    case "sad":
      return { browAngle: -18, browY: 3, eyeOpen: 0.7, mouthCurve: -10, blush: 0 };
    case "surprised":
      return { browAngle: -4, browY: -4, eyeOpen: 1, mouthCurve: 0, blush: 0.2 };
    case "thinking":
      return { browAngle: 6, browY: -1, eyeOpen: 0.8, mouthCurve: 2, blush: 0 };
    case "neutral":
    default:
      return { browAngle: 0, browY: 0, eyeOpen: 0.9, mouthCurve: 4, blush: 0.05 };
  }
}

export function FallbackAvatar({ emotion, mouthOpen, gaze, state }: Props) {
  const [blink, setBlink] = useState(1);
  const f = faceFor(emotion);

  useEffect(() => {
    let timer: number;
    const scheduleBlink = () => {
      timer = window.setTimeout(() => {
        setBlink(0.05);
        window.setTimeout(() => setBlink(1), 120);
        scheduleBlink();
      }, 2200 + Math.random() * 2600);
    };
    scheduleBlink();
    return () => window.clearTimeout(timer);
  }, []);

  const eyeScaleY = Math.max(0.05, f.eyeOpen * blink);
  const pupilDx = gaze.x * 6;
  const pupilDy = gaze.y * 4;
  const mouthH = 6 + mouthOpen * 26;
  const listening = state === "listening";
  const thinking = state === "thinking";

  return (
    <div className={`avatar avatar--${state}`}>
      <svg viewBox="0 0 260 320" width="100%" height="100%" aria-label="Alya mascot">
        <defs>
          <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2f4fb" />
            <stop offset="100%" stopColor="#cdd6ef" />
          </linearGradient>
          <radialGradient id="cheek" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff8fae" />
            <stop offset="100%" stopColor="#ff8fae" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Back hair */}
        <path d="M42 150 Q30 60 130 44 Q230 60 218 150 L214 250 Q210 286 176 292 L84 292 Q50 286 46 250 Z" fill="url(#hair)" />

        {/* Neck + shoulders (uniform hint) */}
        <rect x="108" y="214" width="44" height="34" rx="10" fill="#f0d3c2" />
        <path d="M70 320 Q70 262 130 258 Q190 262 190 320 Z" fill="#33407a" />
        <path d="M124 258 L130 286 L136 258 Z" fill="#e7ecf5" />
        <rect x="126" y="262" width="8" height="40" rx="3" fill="#c0455f" />

        {/* Face */}
        <ellipse cx="130" cy="158" rx="70" ry="78" fill="#fbe4d6" />

        {/* Blush */}
        <ellipse cx="96" cy="182" rx="18" ry="11" fill="url(#cheek)" opacity={f.blush} />
        <ellipse cx="164" cy="182" rx="18" ry="11" fill="url(#cheek)" opacity={f.blush} />

        {/* Eyebrows */}
        <g stroke="#b9c2dd" strokeWidth="5" strokeLinecap="round">
          <line x1="88" y1={132 + f.browY} x2="118" y2={132 + f.browY} transform={`rotate(${f.browAngle} 103 132)`} />
          <line x1="142" y1={132 + f.browY} x2="172" y2={132 + f.browY} transform={`rotate(${-f.browAngle} 157 132)`} />
        </g>

        {/* Eyes */}
        <g>
          <g transform="translate(103 156)">
            <ellipse rx="17" ry={17 * eyeScaleY} fill="#fff" />
            <ellipse cx={pupilDx} cy={pupilDy} rx="10" ry={12 * Math.max(0.1, eyeScaleY)} fill="#4f77d6" />
            <circle cx={pupilDx - 3} cy={pupilDy - 3} r="3" fill="#fff" />
          </g>
          <g transform="translate(157 156)">
            <ellipse rx="17" ry={17 * eyeScaleY} fill="#fff" />
            <ellipse cx={pupilDx} cy={pupilDy} rx="10" ry={12 * Math.max(0.1, eyeScaleY)} fill="#4f77d6" />
            <circle cx={pupilDx - 3} cy={pupilDy - 3} r="3" fill="#fff" />
          </g>
        </g>

        {/* Mouth: width/curve from emotion, height from lip-sync amplitude */}
        <path
          d={`M116 ${206} Q130 ${206 + f.mouthCurve} 144 ${206} Q130 ${206 + mouthH} 116 ${206} Z`}
          fill="#c65b6e"
        />

        {/* Front bangs */}
        <path d="M60 150 Q64 74 130 66 Q196 74 200 150 Q176 118 150 120 L150 96 Q150 120 126 120 Q108 122 108 150 Q92 116 60 150 Z" fill="url(#hair)" />
        {/* Side ribbon ornament */}
        <circle cx="196" cy="112" r="12" fill="#c0455f" />
        <circle cx="196" cy="112" r="5" fill="#e58aa0" />

        {/* Status ring */}
        {(listening || thinking) && (
          <circle
            cx="130"
            cy="158"
            r="92"
            fill="none"
            stroke={listening ? "#7ef0d4" : "#c9a6ff"}
            strokeWidth="3"
            opacity="0.6"
            className="avatar__ring"
          />
        )}
      </svg>
    </div>
  );
}
