/** El navegador pot activar el so quan la persona inicia o reprèn el temporitzador. */
export function createPomodoroSound() {
  let audio: AudioContext | undefined;

  return {
    get available(): boolean {
      return audio?.state === 'running';
    },
    prepare(): void {
      if (typeof AudioContext === 'undefined') return;
      try {
        if (audio === undefined || audio.state === 'closed') audio = new AudioContext();
      } catch {
        return;
      }
      if (audio.state !== 'running') void audio.resume().catch(() => undefined);
    },
    play(): void {
      if (audio?.state !== 'running') return;
      const start = audio.currentTime;
      for (const [index, frequency] of [660, 880].entries()) {
        const at = start + index * 0.16;
        const tone = audio.createOscillator();
        const gain = audio.createGain();
        tone.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.13, at + 0.025);
        gain.gain.linearRampToValueAtTime(0, at + 0.19);
        tone.connect(gain).connect(audio.destination);
        tone.start(at);
        tone.stop(at + 0.19);
      }
    },
    close(): void {
      if (audio !== undefined && audio.state !== 'closed')
        void audio.close().catch(() => undefined);
      audio = undefined;
    },
  };
}
