"use client";

import { useRef, useState, useCallback } from "react";
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrackPublication,
  Track,
  ConnectionState,
} from "livekit-client";

export interface VoicePeer {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
}

interface UseVoiceChatReturn {
  connected: boolean;
  micEnabled: boolean;
  isSpeaking: boolean;
  peers: VoicePeer[];
  join: (url: string, token: string) => Promise<void>;
  leave: () => void;
  toggleMic: () => Promise<void>;
}

/** Attach a remote audio track to a hidden <audio> element so we can hear it. */
function attachAudioTrack(
  publication: RemoteTrackPublication,
  participant: RemoteParticipant,
  audioElements: Map<string, HTMLAudioElement>
) {
  const track = publication.track;
  if (!track || publication.kind !== Track.Kind.Audio) return;

  const key = `${participant.identity}:${publication.trackSid}`;
  if (audioElements.has(key)) return;

  const el = document.createElement("audio");
  el.autoplay = true;
  // Keep element in the DOM so the browser doesn't garbage-collect it
  el.style.display = "none";
  document.body.appendChild(el);
  track.attach(el);
  audioElements.set(key, el);
}

/** Detach and remove a hidden <audio> element. */
function detachAudioTrack(
  publication: RemoteTrackPublication,
  participant: RemoteParticipant,
  audioElements: Map<string, HTMLAudioElement>
) {
  const key = `${participant.identity}:${publication.trackSid}`;
  const el = audioElements.get(key);
  if (!el) return;
  publication.track?.detach(el);
  el.remove();
  audioElements.delete(key);
}

export function useVoiceChat(): UseVoiceChatReturn {
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [peers, setPeers] = useState<VoicePeer[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const updatePeers = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const participants: VoicePeer[] = [];
    room.remoteParticipants.forEach((p: RemoteParticipant) => {
      participants.push({
        identity: p.identity,
        name: p.name || p.identity,
        isSpeaking: p.isSpeaking,
        isMuted: !p.isMicrophoneEnabled,
      });
    });
    setPeers(participants);
  }, []);

  const join = useCallback(
    async (url: string, token: string) => {
      // Disconnect existing room if any
      if (roomRef.current) {
        roomRef.current.disconnect();
      }

      // Clean up any leftover audio elements
      for (const el of audioElementsRef.current.values()) {
        el.remove();
      }
      audioElementsRef.current.clear();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          autoGainControl: true,
          noiseSuppression: true,
          echoCancellation: true,
        },
      });

      roomRef.current = room;

      room.on(RoomEvent.Connected, () => {
        setConnected(true);
        updatePeers();
      });

      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setMicEnabled(false);
        setPeers([]);
        setIsSpeaking(false);
        roomRef.current = null;
        // Clean up all audio elements
        for (const el of audioElementsRef.current.values()) {
          el.remove();
        }
        audioElementsRef.current.clear();
      });

      // Attach remote audio tracks so we can hear other participants
      room.on(
        RoomEvent.TrackSubscribed,
        (track, publication, participant) => {
          if (track.kind === Track.Kind.Audio) {
            attachAudioTrack(
              publication as RemoteTrackPublication,
              participant as RemoteParticipant,
              audioElementsRef.current
            );
          }
          updatePeers();
        }
      );

      room.on(
        RoomEvent.TrackUnsubscribed,
        (track, publication, participant) => {
          if (track.kind === Track.Kind.Audio) {
            detachAudioTrack(
              publication as RemoteTrackPublication,
              participant as RemoteParticipant,
              audioElementsRef.current
            );
          }
          updatePeers();
        }
      );

      room.on(RoomEvent.ParticipantConnected, () => updatePeers());
      room.on(RoomEvent.ParticipantDisconnected, () => updatePeers());
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        updatePeers();
        const localSpeaking = speakers.some(
          (s) => s.identity === room.localParticipant?.identity
        );
        setIsSpeaking(localSpeaking);
      });
      room.on(RoomEvent.TrackMuted, () => updatePeers());
      room.on(RoomEvent.TrackUnmuted, () => updatePeers());

      await room.connect(url, token);
      // Enable mic by default on join
      await room.localParticipant.setMicrophoneEnabled(true);
      setMicEnabled(true);
    },
    [updatePeers]
  );

  const leave = useCallback(() => {
    roomRef.current?.disconnect();
  }, []);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    const next = !micEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicEnabled(next);
  }, [micEnabled]);

  return { connected, micEnabled, isSpeaking, peers, join, leave, toggleMic };
}
