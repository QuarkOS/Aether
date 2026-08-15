import { useEffect, useState } from "react";
import type { AssistantState, Emotion } from "@aether/shared";

import neutral from "../assets/mascot/alya_neutral.png";
import neutralTalk from "../assets/mascot/alya_neutral_talk.png";
import happy from "../assets/mascot/alya_happy.png";
import happyTalk from "../assets/mascot/alya_happy_talk.png";
import smug from "../assets/mascot/alya_smug.png";
import smugTalk from "../assets/mascot/alya_smug_talk.png";
import embarrassed from "../assets/mascot/alya_embarrassed.png";
import embarrassedTalk from "../assets/mascot/alya_embarrassed_talk.png";
import surprised from "../assets/mascot/alya_surprised.png";
import thinking from "../assets/mascot/alya_thinking.png";
import thinkingTalk from "../assets/mascot/alya_thinking_talk.png";
import angry from "../assets/mascot/alya_angry.png";
import angryTalk from "../assets/mascot/alya_angry_talk.png";
import sad from "../assets/mascot/alya_sad.png";
import sadTalk from "../assets/mascot/alya_sad_talk.png";
import shyImg from "../assets/mascot/alya_shy.png";
import shyTalk from "../assets/mascot/alya_shy_talk.png";

interface Props {
  emotion: Emotion;
  mouthOpen: number;
  gaze: { x: number; y: number };
  state: AssistantState;
}

interface Sprite {
  closed: string;
  open?: string;
}

/** Maps each emotion to a closed-mouth sprite and an optional open-mouth frame. */
const SPRITES: Record<Emotion, Sprite> = {
  neutral: { closed: neutral, open: neutralTalk },
  happy: { closed: happy, open: happyTalk },
  smug: { closed: smug, open: smugTalk },
  shy: { closed: shyImg, open: shyTalk },
  embarrassed: { closed: embarrassed, open: embarrassedTalk },
  angry: { closed: angry, open: angryTalk },
  sad: { closed: sad, open: sadTalk },
  surprised: { closed: surprised, open: surprised },
  thinking: { closed: thinking, open: thinkingTalk },
};

/** Image-based mascot: emotion sprites with a two-frame mouth flap for lip-sync. */
export function ImageAvatar({ emotion, mouthOpen, gaze, state }: Props) {
  const sprite = SPRITES[emotion] ?? SPRITES.neutral;
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [emotion]);

  const speaking = state === "speaking";
  // With an open frame we do a crisp 2-frame flap by mouth amplitude; without one
  // (should not happen now), a subtle vertical squash fakes the talking motion.
  const openOpacity = sprite.open ? (mouthOpen > 0.33 ? 1 : 0) : 0;
  const squash = !sprite.open && speaking ? 1 - mouthOpen * 0.05 : 1;

  const parallax = {
    transform: `translate(${gaze.x * 7}px, ${gaze.y * 5}px)`,
  };

  if (broken) {
    // Extremely defensive: if bundled art fails to load, show a soft placeholder.
    return <div className="avatar avatar--placeholder" />;
  }

  return (
    <div className={`avatar avatar--${state}`}>
      <div className="avatar__inner" style={{ ...parallax, transform: `${parallax.transform} scaleY(${squash})` }}>
        <img className="avatar__img" src={sprite.closed} alt="Alya" onError={() => setBroken(true)} draggable={false} />
        {sprite.open && (
          <img
            className="avatar__img avatar__img--open"
            src={sprite.open}
            alt=""
            aria-hidden
            style={{ opacity: openOpacity }}
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
