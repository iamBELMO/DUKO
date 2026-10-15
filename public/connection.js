// Hosted transport: authoritative commands + adaptive state updates over HTTPS.
// Rooms and receipts live in D1, so requests never depend on one running laptop.
export class HostedConnection {
  constructor(request, clientId) {
    this.request=request;this.clientId=clientId;this.readyState=0;
    this.timer=null;this.fetching=false;this.phase='LOBBY';this.revision=-1;this.roomId=null;
    this.start();
  }
  emit(data){if(this.readyState===1)this.onmessage?.({data:JSON.stringify(data)});}
  async start(){
    try{
      await this.request('/api/connect',{clientId:this.clientId});
      if(this.readyState===3)return;
      this.readyState=1;this.onopen?.();this.poll();
    }catch(error){this.fail(error);}
  }
  accept(view){
    if(!view||this.readyState!==1)return;
    if(view.roomId!==this.roomId){this.roomId=view.roomId;this.revision=-1;}
    if(view.revision>this.revision){
      this.revision=view.revision;this.phase=view.phase;this.emit({type:'view',view});
    }
  }
  async poll(){
    if(this.readyState!==1||this.fetching)return;
    clearTimeout(this.timer);this.fetching=true;
    const started=Date.now();
    try{
      const message=await this.request('/api/state');
      this.emit({type:'pong',clientTime:started,serverTime:message.view.serverNow});
      this.accept(message.view);
    }catch(error){
      if(error.code!=='ROOM_BUSY')this.fail(error);
    }finally{
      this.fetching=false;
      if(this.readyState===1)this.timer=setTimeout(()=>this.poll(),document.hidden?2000:['LOBBY','ROUND_END'].includes(this.phase)?1000:180);
    }
  }
  send(raw){
    if(this.readyState!==1)return;
    const message=JSON.parse(raw);
    if(message.type==='ping'||message.type==='sync'){this.poll();return;}
    if(message.type==='command')this.command(message.envelope);
  }
  async command(envelope){
    try{
      const result=await this.request('/api/command',{envelope});
      this.emit(result.receipt);this.accept(result.view);
    }catch(error){
      if(['SESSION_EXPIRED','SESSION_REPLACED','ROOM_NOT_FOUND'].includes(error.code))this.fail(error);
      else if(error.code && error.code!=='ROOM_BUSY')this.emit({type:'receipt',commandId:envelope.commandId,ok:false,code:error.code});
      // Uncertain delivery is retried by the caller with the same commandId.
    }
  }
  fail(error){
    if(this.readyState===3)return;
    const code=error.code==='SESSION_REPLACED'?4001:error.code==='SESSION_EXPIRED'?4003:error.code==='ROOM_NOT_FOUND'?4004:1006;
    this.readyState=3;clearTimeout(this.timer);this.onclose?.({code});
  }
  close(){this.readyState=3;clearTimeout(this.timer);}
}
