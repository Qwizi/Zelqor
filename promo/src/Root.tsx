import { Composition } from "remotion";
import { MapLordTrailer } from "./sequences/Trailer";
import { TikTokTrailer } from "./sequences/TikTok";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MapLordTrailer"
        component={MapLordTrailer}
        durationInFrames={2860}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="TikTok"
        component={TikTokTrailer}
        durationInFrames={660} // 22 seconds at 30fps
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
