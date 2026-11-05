import { Composition } from 'remotion';
import { WikilinkFanOut } from './clips/WikilinkFanOut';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="wikilink-fan-out"
      component={WikilinkFanOut}
      durationInFrames={480}
      fps={60}
      width={1920}
      height={1080}
    />
  );
};
