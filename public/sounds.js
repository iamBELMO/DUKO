// Small synthesized cues. No audio files, dependencies, or network requests.
const notes={click:[430],deal:[280,360,450],flip:[720,960],draw:[340,510],discard:[280,190],fire:[240,680,1040],win:[440,554,659,880],lose:[310,260,210]};
export function createSoundManager(enabled){
  let context=null,lastAt=0;
  function unlock(){
    if(!enabled())return;
    try{context??=new (window.AudioContext||window.webkitAudioContext)();void context.resume().catch(()=>{});}catch{}
  }
  function play(event,{haptic=false}={}){
    if(!enabled())return;
    const now=performance.now();if(now-lastAt<55&&event==='click')return;lastAt=now;
    unlock();
    if(context?.state==='running')try{
      const frequencies=notes[event]||notes.click;
      for(const [index,frequency] of frequencies.entries()){
        const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+index*.045;
        oscillator.type=event==='discard'?'triangle':'sine';oscillator.frequency.setValueAtTime(frequency,start);
        if(['draw','flip','fire'].includes(event))oscillator.frequency.exponentialRampToValueAtTime(frequency*1.15,start+.07);
        gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(event==='win'?.045:.028,start+.008);
        gain.gain.exponentialRampToValueAtTime(.0001,start+.12);oscillator.connect(gain);gain.connect(context.destination);
        oscillator.start(start);oscillator.stop(start+.14);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      }
    }catch{}
    if(haptic&&typeof navigator.vibrate==='function')try{navigator.vibrate(event==='fire'?[16,25,12]:event==='win'?[20,35,20]:10);}catch{}
  }
  return {play,unlock};
}
