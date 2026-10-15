const shapes={
  spades:'M12 2C9.4 6.2 3 9.1 3 14a5 5 0 0 0 8 4c-.1 2-1 3.4-2.2 4h6.4C14 21.4 13.1 20 13 18a5 5 0 0 0 8-4c0-4.9-6.4-7.8-9-12Z',
  hearts:'M12 21S2 14.5 2 8.2C2 2.4 9.1 1 12 6c2.9-5 10-3.6 10 2.2C22 14.5 12 21 12 21Z',
  diamonds:'m12 1 9 11-9 11L3 12 12 1Z',
  clubs:'M12 2a4.5 4.5 0 0 0-3.6 7.2A5.2 5.2 0 1 0 11 18c-.2 2-1 3.3-2.2 4h6.4c-1.2-.7-2-2-2.2-4a5.2 5.2 0 1 0 2.6-8.8A4.5 4.5 0 0 0 12 2Z'
};
export const suitNames={spades:'بستوني',hearts:'كبة',diamonds:'ديناري',clubs:'سباتي'};
export function suitSvg(suit){return '<svg class="suit-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="'+(shapes[suit]||shapes.spades)+'"/></svg>';}
const pair=y=>[[26,y],[74,y]];
const positions={2:[[50,0],[50,100]],3:[[50,0],[50,50],[50,100]],4:[...pair(0),...pair(100)],5:[...pair(0),[50,50],...pair(100)],6:[...pair(0),...pair(50),...pair(100)],7:[...pair(0),[50,25],...pair(50),...pair(100)],8:[...pair(0),[50,25],...pair(50),[50,75],...pair(100)],9:[...pair(0),...pair(33),[50,50],...pair(67),...pair(100)],10:[...pair(0),...pair(25),...pair(50),...pair(75),...pair(100)]};
export function cardFace(face){
  const red=face.suit==='hearts'||face.suit==='diamonds',joker=face.rank==='JOKER';
  const rank=joker?'★':String(face.rank),suit=joker?'<span>✦</span>':suitSvg(face.suit);
  const corner=position=>'<span class="card-corner '+position+'"><b>'+rank+'</b><small>'+suit+'</small></span>';
  let center;
  if(joker)center='<span class="joker-art"><svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M16 26 28 37 40 13 52 37 64 26 57 53H23Z" fill="currentColor"/><circle cx="16" cy="23" r="4" fill="currentColor"/><circle cx="40" cy="10" r="4" fill="currentColor"/><circle cx="64" cy="23" r="4" fill="currentColor"/><path d="M27 60c8 11 18 11 26 0M30 47h.1M50 47h.1" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg><small>JOKER</small></span>';
  else if(face.rank==='A')center='<span class="ace-art">'+suit+'</span>';
  else if(['J','Q','K'].includes(face.rank))center='<span class="royal-art"><span class="royal-crown">♛</span><strong>'+rank+'</strong>'+suit+'</span>';
  else center='<span class="card-pips">'+positions[face.rank].map(([x,y])=>'<span style="--px:'+x+'%;--py:'+y+'%;--flip:'+(y>50?'180deg':'0deg')+'">'+suit+'</span>').join('')+'</span>';
  // Opponent hands use the same face but simplify the centre at small sizes.
  return {red,joker,html:corner('')+center+'<span class="compact-face"><b>'+rank+'</b>'+suit+'</span>'+corner('bottom')+(joker?'<span class="foil-sheen" aria-hidden="true"></span>':'')};
}
