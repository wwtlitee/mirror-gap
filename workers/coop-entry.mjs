const VERSION='8.5.0';

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/')url.pathname='/coop.html';
    const asset=await env.ASSETS.fetch(new Request(url,request));
    const headers=new Headers(asset.headers);headers.set('X-MirrorGap-Version',VERSION);
    return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
  },
};
