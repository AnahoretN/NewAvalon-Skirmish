import{r as x,j as e}from"./vendor-react-DCrF76SZ-0.4.4.js";import{u as b,C as g,a as w}from"./index-Blyrph3T-0.4.4.js";import{D as f,S as v}from"./game-logic-B1HffBQG-0.4.4.js";import"./vendor-DQhf2rhQ-0.4.4.js";const j={title:'Game Rules: "New Avalon: Skirmish"',conceptTitle:"I. General Concept",conceptText:`**Genre & Role:** New Avalon: Skirmish is a fast-paced tactical duel card game played on a restricted grid battlefield. Players act as faction leaders, deploying Units and Commands to seize control of key lines.

**Explanation:** The game focuses on positional control and the timing of ability activation rather than just direct attacks. Victory is achieved by accumulating Victory Points (VP) based on the power of your units in selected lines.`,winConditionTitle:"II. Victory Conditions",winConditionText:`**Match Victory:** A match is played until a player wins 2 rounds. The first player to reach 2 round wins immediately wins the match.
**Match Draw:** If multiple players reach 2 round wins simultaneously after any round, they are all declared match winners.

**Round Victory (Thresholds & Limits):** A round ends as soon as one or more players reach the Victory Point (VP) threshold, or after the 5th turn is completed.
**Turn Limit:** Each round is limited to 5 full turns per player. If the VP threshold is not met, a final scoring occurs at the end of Turn 5 to determine the winner.

**Thresholds:**
- Round 1: 20 Victory Points (VP).
- Round 2: 30 Victory Points (VP).
- Round 3+: Threshold increases by +10 VP from the previous round (e.g., Round 3 is 40 VP).

**Determining Round Winner:** The winner is the player who hits the threshold first, or the player with the highest VP after the turn limit.
**Round Draw:** If two or more players have the same highest score at the end of a round, they all are declared winners of that round.`,fieldTitle:"III. Game Board & Components",fieldText:`**Battlefield (Grid):** The game takes place on a square grid, the size of which depends on the total number of participating players.
**Sizes:**
- 2 Players: 5x5 grid.
- 3 Players: 6x6 grid.
- 4 Players: 7x7 grid.

**Positioning Definitions:**
- **Line:** Refers to an entire horizontal Row or vertical Column. Used for the Scoring mechanic.
- **Adjacency:** Cells are considered adjacent only horizontally and vertically (orthogonally). Diagonal adjacency does not count unless specified otherwise on a card.

**Cards:** Two main types of cards are played from Hand:
- **Units:** The main combat entities, possessing Power and Abilities. They remain on the battlefield until destroyed.
- **Commands:** Instant-effect cards. They are played, execute their effect (often offering a "Choose 1 of 2 options" choice), and are then sent to the Discard pile.

**Game Zones:**
- **Hand:** Cards hidden from opponents.
- **Discard:** The zone where destroyed Units and played Commands go.
- **Showcase/Announced:** A temporary zone where a Command card is placed before it resolves.`,setupTitle:"IV. Game Start (Setup)",setupText:`**Deck Construction:** Before the match begins, each player selects a faction or builds a deck according to construction rules (minimum 30 cards).
**Explanation:** Decks are shuffled.

**Starting Hand:** Each player draws 6 cards from their deck to form their starting hand.
**Hidden Information:** Cards in hand are hidden from opponents.

**Mulligan:** Once at the start of the game, after drawing the starting hand, a player may shuffle any number of cards from their hand back into the deck and draw the same number of new cards.

**First Player Determination:** Determine the first active player by any convenient method (e.g., coin toss).
**Explanation:** Play proceeds in turn order, starting with the first player. The first player begins their first turn directly in the Setup Phase.`,abilitiesTitle:"V. Card Abilities",abilitiesText:`**Ability Types:**
- **Deploy:** Triggers automatically and immediately when the card is played from hand onto the battlefield face-up.
- **Setup:** Triggers automatically at the start of the Setup Phase of each of your turns (before drawing a card), if the card is already face-up on the battlefield.
- **Commit:** Triggers automatically at the start of the Commit Phase of each of your turns, if the card is already face-up on the battlefield.
- **Pas (Passive):** The effect is constantly active as long as the card is on the battlefield and face-up.

**Conditions (⇒):**
Many abilities have a requirement denoted by an arrow (e.g., **Support ⇒ Deploy:** ...).
- This means "CONDITION ⇒ EFFECT".
- If the condition to the left of the arrow (e.g., having Support status) is not met at the moment of activation, the ability **does not trigger** at all.

**Important Rules:**
- **Stun:** Stunned cards (with a Stun token) **do not activate** their abilities (neither Deploy, nor Phased, nor Passive).
- **Face-down:** Cards played face-down have no abilities.
- **Mandatory:** If an ability triggers (conditions met), you **must** apply its effect if there are legal targets. If there are no legal targets, the ability fizzles.`,statusesTitle:"VI. Dynamic Statuses (Positioning)",statusesText:`Dynamic statuses are calculated automatically and constantly updated with any change on the board. Units with the Stun status cannot provide or participate in the calculation of these statuses.

**Support:** A unit has the Support status if there is an allied unit in at least one adjacent cell (horizontal or vertical).
**Stun/Support:** A unit with a Stun token is ignored when calculating Support for adjacent allies.
**Significance:** Having Support is a condition for activating many powerful abilities, denoted by the syntax **Support ⇒ [Effect]**.

**Threat:** A unit receives the Threat status if it is in a dangerous position created by enemy units.
**Conditions:** Threat status is assigned in one of two cases:
1. **Pinned:** The unit is sandwiched between cards of a single opponent on any two sides (two adjacent or two opposite sides).
2. **Cornered:** The unit is on the edge of the battlefield and has at least one opponent card adjacent to it.
**Stun/Threat:** A unit with a Stun token is ignored when calculating Threat for adjacent enemies.
**Significance:** Units under Threat are vulnerable targets for powerful control and destruction abilities.`,countersTitle:"VII. Counters",countersText:`Counters are persistent markers placed by card abilities. They remain on a unit until removed or the unit is destroyed.

**Stun (O):**
- **Effect:** A Stunned unit generates 0 VP during the Scoring Phase, cannot activate its abilities, and cannot be moved by its owner (but can be moved by opponents).
- **Removal:** At the end of the Commit Phase, 1 Stun token is automatically removed from every unit owned by the active player.

**Shield (S):**
- **Effect:** If an ability attempts to Destroy this unit, the destruction effect is prevented, and 1 Shield token is removed instead. The unit remains on the field.

**Revealed & Face-down:**
- **Revealed:** Allows the player who owns the Revealed token to see the hidden information (face) of the card.
- **Face-down Explanation:** A card played face-down has 0 Power and no Abilities. If such a card receives a Revealed token, its info becomes visible to the opponent, but it is still mechanically considered Face-down (0 Power, no abilities).

**Special Tokens (Aim, Exploit):**
- **Aim (A) & Exploit (E):** These tokens act as markers for faction interactions (e.g., Snipers or Hackers). By themselves, they have no inherent game effect.

**Last Played:**
- **Effect:** A temporary status automatically assigned to the last card played onto the battlefield by the active player this turn. This status determines the line the player must choose for Scoring.`,turnTitle:"VIII. Turn Structure & Timing",turnText:`The turn passes from player to player. Card abilities only trigger during their owner's turn. The active player's turn consists of four sequential phases:

**1. Setup Phase:**
- **Draw Card:** The active player draws 1 card from their deck.
- **Abilities:** Abilities of all cards on the board with the keyword **Setup:** trigger.
**Explanation:** This phase is for replenishing the hand and initial unit positioning.

**2. Main Phase (Action / Deploy):**
- **Main Action:** The active player may perform one of the following:
  - Play a Unit card (**Deploy:**) from hand to any empty cell. Its **Deploy:** ability triggers immediately.
  - Play a Command card from hand.
  - Pass.
**Command Explanation:** Command cards can be played in any quantity during this phase — before, after, or between unit deployments.

**3. Commit Phase:**
- **Abilities:** Abilities of all cards on the board with the keyword **Commit:** trigger.
- **Remove Stun:** At the end of this phase, 1 Stun token is automatically removed from every unit owned by the active player.
**Explanation:** This phase is used for applying control effects and gaining resources before scoring.

**4. Scoring Phase:**
- **Line Selection:** The active player must choose one Line (Row or Column) that passes through their card with the **Last Played** status.
- **Counting:** The Power of all units owned by the active player in the chosen line is summed up, and the total is added to the player's score.`,mechanicsTitle:"IX. Conflict Resolution & Key Mechanics",mechanicsText:`**Stun & Scoring:**
- **Effect:** A unit with Stun status or one that is Face-down contributes 0 points during the Scoring Phase, regardless of its base Power, permanent modifiers, or passive abilities that generate points (e.g., Spotter).

**Last Played Transfer:**
- **Destruction:** If the card with Last Played status leaves the battlefield (destroyed, returned to hand/deck) before the Scoring Phase, the status is transferred to the *previous* card played by that player (the one that was Last Played in the previous turn/action).
- **Movement:** If the card with Last Played moves to another cell, the player chooses lines based on its new position during Scoring.
- **Absence:** If a player has no cards on the board with Last Played status, they cannot choose a line and gain no points this turn.

**Unit Movement (Push, Swap):**
- **Push:** A unit forces another card to move to an adjacent cell. The push is blocked (does not happen) if the destination is an occupied cell or the edge of the board. Other effects of the ability still apply to the target.
- **Swap:** Allows two cards to trade places, even if both cells are occupied.

**Resurrect:**
- **Burnout Mechanic:** A card returned to the battlefield from the Discard pile (resurrected) immediately gains the **Resurrected** status upon Deploy. At the start of the next phase (phase change), this status is removed, and the card receives two Stun tokens.`,creditsTitle:"X. Credits",creditsText:`**Author:** Nikita Anahoret

**Powered By:**
- Google AI Studio
- Gemini
- ChatGPT

**Special Thanks:**
- Vasilisa Versus
- Kirill Tomashchuk
- Andrey Markosov
- Mitya Shepelin

For questions and suggestions, please contact via Telegram or Discord.
Support game development and authors via DonationAlerts and Patreon.`},T="https://res.cloudinary.com/dxxh6meej/image/upload/v1771367448/N_Reclaimed_Gawain_sjmlsp.webp",N="/images/cards/FUS_DEVOUT_SYNTHETIC.png",d={gawain:{id:"demo_gawain",name:'Reclaimed "Gawain"',deck:f.Neutral,power:4,imageUrl:T,fallbackImage:N,abilityText:`Deploy: Shield 1. Push an adjacent card 1 cell. May take its place.
Setup: Destroy an adjacent card with threat or stun.`,types:["Unit","Device","Rarity"],faction:"Neutral",ownerId:1},riot:{id:"demo_riot",name:"Riot Agent",deck:f.SynchroTech,power:3,imageUrl:"https://res.cloudinary.com/dxxh6meej/image/upload/v1771365236/SYN_RIOT_AGENT_i4lk5m.webp",fallbackImage:"/images/cards/SYN_RIOT_AGENT.png",abilityText:"Deploy: Push.",types:["Unit","SynchroTech"],faction:"SynchroTech",ownerId:1},princeps:{id:"demo_princeps",name:"Princeps",deck:f.Optimates,power:3,imageUrl:"https://res.cloudinary.com/dxxh6meej/image/upload/v1771365252/OPT_PRINCEPS_aaqakx.webp",fallbackImage:"/images/cards/OPT_PRINCEPS.png",abilityText:"",types:["Unit","Optimates"],faction:"Optimates",ownerId:2}},y=new Map([[1,"blue"],[2,"red"]]),S=s=>s.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g).map((n,r)=>{const t=n.match(/\[([^\]]+)\]\(([^)]+)\)/);if(t){const c=t[1],h=t[2];return e.jsx("a",{href:h,target:"_blank",rel:"noopener noreferrer",className:"text-sky-400 hover:text-sky-300 underline font-medium",children:c},r)}return n.startsWith("**")&&n.endsWith("**")?e.jsx("strong",{className:"text-indigo-300",children:n.slice(2,-2)},r):n}),u=({children:s})=>e.jsxs("div",{className:"w-full h-full bg-board-bg/50 rounded-vu-2 shadow-inner border-2 border-gray-600/50 flex items-center justify-center overflow-hidden relative p-4",children:[e.jsx("div",{className:"absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-transparent to-transparent pointer-events-none"}),s]}),P=()=>e.jsx(u,{children:e.jsxs("div",{className:"flex gap-16 items-center justify-center relative pl-4 scale-90 md:scale-100",children:[e.jsxs("div",{className:"relative w-48 h-48 flex-shrink-0",children:[e.jsx(g,{card:d.gawain,isFaceUp:!0,playerColorMap:y,localPlayerId:1,disableTooltip:!0}),e.jsx("div",{className:"absolute -bottom-2 -right-2 w-full h-full pointer-events-none",children:e.jsxs("div",{className:"absolute bottom-[-45px] right-[5px] flex flex-col items-center",children:[e.jsx("div",{className:"w-px h-8 bg-white mb-1"}),e.jsx("div",{className:"bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg border border-white whitespace-nowrap",children:"Power"})]})})]}),e.jsx("div",{className:"relative w-80 flex-shrink-0",children:e.jsxs("div",{className:"bg-gray-900 border border-gray-700 rounded-vu-2 shadow-2xl p-3 text-white relative",children:[e.jsx(w,{card:d.gawain}),e.jsxs("div",{className:"absolute top-4 -left-[90px] flex items-center",children:[e.jsx("div",{className:"bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg border border-white",children:"Name"}),e.jsx("div",{className:"w-[60px] h-px bg-white ml-2"}),e.jsx("div",{className:"w-1.5 h-1.5 bg-white rounded-full -ml-1"})]}),e.jsxs("div",{className:"absolute top-10 -left-[90px] flex items-center",children:[e.jsx("div",{className:"bg-purple-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg border border-white",children:"Types"}),e.jsx("div",{className:"w-[60px] h-px bg-white ml-2"}),e.jsx("div",{className:"w-1.5 h-1.5 bg-white rounded-full -ml-1"})]}),e.jsxs("div",{className:"absolute bottom-12 -left-[90px] flex items-center",children:[e.jsx("div",{className:"bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg border border-white",children:"Abilities"}),e.jsx("div",{className:"w-[60px] h-px bg-white ml-2"}),e.jsx("div",{className:"w-1.5 h-1.5 bg-white rounded-full -ml-1"})]})]})})]})}),m=({text:s,subtext:a,color:n,top:r,left:t,subtextAbove:c=!1})=>{const h=n==="green"?"border-green-500/50":"border-red-500/50",o=n==="green"?"text-green-400":"text-red-400";return e.jsxs("div",{className:`absolute ${r} ${t} text-center w-28 pointer-events-none z-20 flex flex-col items-center`,children:[a&&c&&e.jsx("div",{className:"text-gray-400 text-[9px] font-semibold mb-0.5 leading-tight whitespace-nowrap",children:a}),e.jsx("div",{className:`${o} font-bold text-[10px] uppercase tracking-wider bg-gray-900/90 px-2 py-1 rounded shadow-sm border ${h}`,children:s}),a&&!c&&e.jsx("div",{className:"text-gray-400 text-[9px] font-semibold mt-0.5 leading-tight",children:a})]})},k=()=>{const s=Array(16).fill(null),a={...d.riot,id:"s1",statuses:[{type:"Support",addedByPlayerId:1}]},n={...d.riot,id:"s2",statuses:[{type:"Support",addedByPlayerId:1}]},r={...d.princeps,id:"e1",statuses:[{type:"Threat",addedByPlayerId:1}]},t={...d.riot,id:"v1",statuses:[{type:"Threat",addedByPlayerId:2}]},c={...d.princeps,id:"e2",statuses:[{type:"Threat",addedByPlayerId:1}]};return e.jsx(u,{children:e.jsxs("div",{className:"relative scale-[0.8] md:scale-100 origin-center",children:[e.jsx("div",{className:"grid grid-cols-4 grid-rows-4 gap-1 w-[460px] h-[452px]",children:s.map((h,o)=>{const p=Math.floor(o/4),l=o%4;let i=null;return p===1&&l===0&&(i=a),p===1&&l===1&&(i=n),p===2&&l===1&&(i=r),p===2&&l===2&&(i=t),p===2&&l===3&&(i=c),e.jsx("div",{className:"relative w-full h-full bg-board-cell/30 rounded border border-white/5 flex items-center justify-center",children:i&&e.jsx("div",{className:"w-28 h-28 p-0",children:e.jsx(g,{card:i,isFaceUp:!0,playerColorMap:y,localPlayerId:1,disableTooltip:!0,smallStatusIcons:!0})})},o)})}),e.jsx(m,{text:"Support",subtext:"Adjacent Ally",color:"green",top:"top-[68px]",left:"left-[0px]",subtextAbove:!0}),e.jsx(m,{text:"Support",subtext:"Adjacent Ally",color:"green",top:"top-[68px]",left:"left-[116px]",subtextAbove:!0}),e.jsx(m,{text:"Threat",subtext:"Pinned",color:"red",top:"top-[345px]",left:"left-[116px]"}),e.jsx(m,{text:"Threat",subtext:"Pinned",color:"red",top:"top-[345px]",left:"left-[232px]"}),e.jsx(m,{text:"Threat",subtext:e.jsxs(e.Fragment,{children:["Cornered",e.jsx("br",{}),"(Enemy + Edge)"]}),color:"red",top:"top-[345px]",left:"left-[348px]"})]})})},C=()=>e.jsx(u,{children:e.jsxs("div",{className:"grid grid-cols-4 gap-1 w-64 aspect-square relative scale-[1.3] origin-center",children:[Array.from({length:16}).map((s,a)=>e.jsx("div",{className:"bg-board-cell/40 rounded border border-white/5"},a)),e.jsx("div",{className:"absolute top-[25%] left-0 right-0 h-[25%] bg-yellow-500/30 border-y-2 border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.4)] pointer-events-none flex items-center justify-end px-2 z-10",children:e.jsx("span",{className:"text-[8px] font-black text-yellow-200 uppercase tracking-wider drop-shadow-md",children:"Row"})}),e.jsx("div",{className:"absolute top-0 bottom-0 left-[50%] w-[25%] bg-indigo-500/30 border-x-2 border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.4)] pointer-events-none flex items-end justify-center py-2 z-10",children:e.jsx("span",{className:"text-[8px] font-black text-indigo-200 uppercase tracking-wider whitespace-nowrap drop-shadow-md mb-1",children:"Column"})})]})}),A=({demoImageRefreshVersion:s})=>{const a=[d.gawain,d.riot,d.gawain];return e.jsx(u,{children:e.jsxs("div",{className:"flex flex-col items-center gap-6 w-full",children:[e.jsxs("div",{className:"bg-gray-800 rounded-vu-2 p-3 shadow-xl border border-gray-700 w-auto",children:[e.jsx("div",{className:"text-[10px] text-gray-400 mb-2 font-bold uppercase tracking-wider pl-1",children:"Hand (6 Cards)"}),e.jsx("div",{className:"flex gap-2 justify-center bg-gray-900/50 rounded p-2",children:a.map((n,r)=>e.jsx("div",{className:"w-28 h-28 flex-shrink-0 relative shadow-lg",children:e.jsx(g,{card:{...n,id:`hand_demo_${r}`},isFaceUp:!0,playerColorMap:y,localPlayerId:1,disableTooltip:!0,imageRefreshVersion:s})},r))})]}),e.jsxs("div",{className:"flex items-center gap-2 opacity-70",children:[e.jsx("div",{className:"w-8 h-8 rounded-full border-2 border-dashed border-white/30 flex items-center justify-center animate-pulse",children:e.jsx("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"3",className:"text-indigo-400",children:e.jsx("path",{d:"M12 5v14M19 12l-7 7-7-7"})})}),e.jsx("span",{className:"text-xs text-gray-400",children:"Drag to Board"})]})]})})},I=()=>{const s=["Stun","Shield","Revealed","Aim","Exploit","Support","Threat"];return e.jsx(u,{children:e.jsx("div",{className:"grid grid-cols-4 gap-4 p-4 w-full",children:s.map(a=>{const n=v[a];return e.jsxs("div",{className:"flex flex-col items-center gap-2 p-2 bg-gray-800/50 rounded border border-white/5 hover:bg-gray-800 transition-colors",children:[e.jsx("div",{className:"w-10 h-10 rounded-full border-2 border-white/30 flex items-center justify-center shadow-lg relative bg-gradient-to-br from-gray-700 to-gray-900",children:n?e.jsx("img",{src:n,alt:a,className:"w-6 h-6 object-contain drop-shadow-md"}):e.jsx("span",{className:"font-bold text-white text-base",children:a[0]})}),e.jsx("span",{className:"text-[10px] font-bold text-gray-300 uppercase tracking-wider text-center leading-tight",children:a})]},a)})})})},V=({isOpen:s,onClose:a})=>{const{resources:n,t:r}=b(),t=n.rules&&n.rules.title?n.rules:j,c=x.useMemo(()=>Date.now(),[]),h=x.useMemo(()=>[{id:"concept",title:t.conceptTitle,text:t.conceptText,visual:e.jsx(P,{})},{id:"winCondition",title:t.winConditionTitle,text:t.winConditionText,visual:e.jsx(u,{children:e.jsxs("div",{className:"text-center text-yellow-400 font-black text-8xl font-mono bg-gray-900 p-10 rounded-3xl border-8 border-yellow-500 shadow-[0_0_50px_#eab308] scale-[1.2]",children:["30 ",e.jsx("div",{className:"text-lg font-bold text-gray-400 font-sans mt-2 uppercase tracking-widest",children:"Points"})]})})},{id:"field",title:t.fieldTitle,text:t.fieldText,visual:e.jsx(C,{})},{id:"setup",title:t.setupTitle,text:t.setupText,visual:e.jsx(A,{demoImageRefreshVersion:c})},{id:"abilities",title:t.abilitiesTitle,text:t.abilitiesText,visual:null},{id:"statuses",title:t.statusesTitle,text:t.statusesText,visual:e.jsx(k,{})},{id:"counters",title:t.countersTitle,text:t.countersText,visual:e.jsx(I,{})},{id:"turn",title:t.turnTitle,text:t.turnText,visual:null},{id:"mechanics",title:t.mechanicsTitle,text:t.mechanicsText,visual:null},{id:"credits",title:t.creditsTitle,text:t.creditsText,visual:null}],[t,c]),[o,p]=x.useState("concept"),l=x.useMemo(()=>h.find(i=>i.id===o)||h[0],[o,h]);return s?e.jsx("div",{className:"fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[100]",onClick:a,children:e.jsxs("div",{className:"bg-gray-900 w-[95vw] h-[90vh] rounded-vu-2 shadow-2xl flex overflow-hidden border border-gray-700",onClick:i=>i.stopPropagation(),children:[e.jsxs("div",{className:"w-64 bg-gray-800 border-r border-gray-700 flex flex-col flex-shrink-0",children:[e.jsx("div",{className:"p-4 border-b border-gray-700 bg-gray-850",children:e.jsx("h2",{className:"text-xl font-bold text-indigo-400 tracking-wide",children:t.title})}),e.jsx("div",{className:"flex-grow overflow-y-auto p-2 space-y-1",children:h.map(i=>e.jsxs("button",{onClick:()=>p(i.id),className:`w-full text-left px-4 py-3 rounded-vu-2 transition-all duration-200 text-sm font-medium flex items-center justify-between ${o===i.id?"bg-indigo-600 text-white shadow-lg translate-x-1":"text-gray-400 hover:bg-gray-700 hover:text-gray-200"}`,children:[e.jsx("span",{className:"truncate",children:i.title}),o===i.id&&e.jsx("span",{className:"text-indigo-300",children:"▶"})]},i.id))}),e.jsx("div",{className:"p-4 border-t border-gray-700",children:e.jsx("button",{onClick:a,className:"w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 rounded transition-colors uppercase text-sm tracking-wider",children:r("close")})})]}),e.jsxs("div",{className:"flex-grow flex flex-col md:flex-row overflow-hidden bg-gray-900",children:[e.jsx("div",{className:"flex-1 p-8 overflow-y-auto custom-scrollbar",children:e.jsxs("div",{className:"max-w-2xl mx-auto",children:[e.jsx("h1",{className:"text-3xl font-black text-white mb-8 pb-4 border-b-2 border-indigo-500/50",children:l.title}),e.jsx("div",{className:"prose prose-invert prose-lg text-gray-300 leading-relaxed whitespace-pre-wrap",children:S(l.text)})]})}),e.jsxs("div",{className:"hidden md:flex w-[45%] bg-gray-850 border-l border-gray-700 flex-col items-center justify-start p-6 relative overflow-hidden",children:[e.jsx("h3",{className:"text-center text-gray-500 text-xs uppercase tracking-[0.3em] font-bold z-20 opacity-70 mb-2 absolute top-6",children:"Visual Example"}),e.jsx("div",{className:"relative z-10 w-full h-[65%] mt-20 flex items-center justify-center",children:l.visual?l.visual:e.jsxs("div",{className:"text-gray-600 italic flex flex-col items-center opacity-40",children:[e.jsx("svg",{className:"w-16 h-16 mb-2",fill:"none",stroke:"currentColor",viewBox:"0 0 24 24",children:e.jsx("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:2,d:"M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"})}),"No visual available"]})})]})]})]})}):null};export{V as RulesModal};
