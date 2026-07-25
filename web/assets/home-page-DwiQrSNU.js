const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-DObwXlqC.js","assets/index-B3f8Rhiy.css"])))=>i.map(i=>d[i]);
import{i as rt,a as at,b as M,t as nt,g as ut,c as ft,d as pt,e as ct,s as Ct,f as Bt,h as Et,j as B,k as Dt,l as Lt,m as Mt,n as Pt,_ as vt,o as Rt}from"./index-DObwXlqC.js";import{n as N,r as K}from"./state-DP_Gdnim.js";import{i as j}from"./app-scaffold-uGeBETJM.js";import{c as It}from"./clipboard-C3x8_sid.js";import{f as Nt,a as ht,b as gt,c as Ot}from"./format-BcWb47bn.js";var bt=(function(){var c=function(b,x){var u=236,h=17,a=b,p=k[x],e=null,t=0,v=null,l=[],f={},A=function(n,o){t=a*4+17,e=(function(r){for(var i=new Array(r),s=0;s<r;s+=1){i[s]=new Array(r);for(var g=0;g<r;g+=1)i[s][g]=null}return i})(t),C(0,0),C(t-7,0),C(0,t-7),F(),P(),Y(n,o),a>=7&&Q(n),v==null&&(v=Tt(a,p,l)),J(v,o)},C=function(n,o){for(var r=-1;r<=7;r+=1)if(!(n+r<=-1||t<=n+r))for(var i=-1;i<=7;i+=1)o+i<=-1||t<=o+i||(0<=r&&r<=6&&(i==0||i==6)||0<=i&&i<=6&&(r==0||r==6)||2<=r&&r<=4&&2<=i&&i<=4?e[n+r][o+i]=!0:e[n+r][o+i]=!1)},D=function(){for(var n=0,o=0,r=0;r<8;r+=1){A(!0,r);var i=m.getLostPoint(f);(r==0||n>i)&&(n=i,o=r)}return o},P=function(){for(var n=8;n<t-8;n+=1)e[n][6]==null&&(e[n][6]=n%2==0);for(var o=8;o<t-8;o+=1)e[6][o]==null&&(e[6][o]=o%2==0)},F=function(){for(var n=m.getPatternPosition(a),o=0;o<n.length;o+=1)for(var r=0;r<n.length;r+=1){var i=n[o],s=n[r];if(e[i][s]==null)for(var g=-2;g<=2;g+=1)for(var w=-2;w<=2;w+=1)g==-2||g==2||w==-2||w==2||g==0&&w==0?e[i+g][s+w]=!0:e[i+g][s+w]=!1}},Q=function(n){for(var o=m.getBCHTypeNumber(a),r=0;r<18;r+=1){var i=!n&&(o>>r&1)==1;e[Math.floor(r/3)][r%3+t-8-3]=i}for(var r=0;r<18;r+=1){var i=!n&&(o>>r&1)==1;e[r%3+t-8-3][Math.floor(r/3)]=i}},Y=function(n,o){for(var r=p<<3|o,i=m.getBCHTypeInfo(r),s=0;s<15;s+=1){var g=!n&&(i>>s&1)==1;s<6?e[s][8]=g:s<8?e[s+1][8]=g:e[t-15+s][8]=g}for(var s=0;s<15;s+=1){var g=!n&&(i>>s&1)==1;s<8?e[8][t-s-1]=g:s<9?e[8][15-s-1+1]=g:e[8][15-s-1]=g}e[t-8][8]=!n},J=function(n,o){for(var r=-1,i=t-1,s=7,g=0,w=m.getMaskFunction(o),_=t-1;_>0;_-=2)for(_==6&&(_-=1);;){for(var L=0;L<2;L+=1)if(e[i][_-L]==null){var R=!1;g<n.length&&(R=(n[g]>>>s&1)==1);var T=w(i,_-L);T&&(R=!R),e[i][_-L]=R,s-=1,s==-1&&(g+=1,s=7)}if(i+=r,i<0||t<=i){i-=r,r=-r;break}}},V=function(n,o){for(var r=0,i=0,s=0,g=new Array(o.length),w=new Array(o.length),_=0;_<o.length;_+=1){var L=o[_].dataCount,R=o[_].totalCount-L;i=Math.max(i,L),s=Math.max(s,R),g[_]=new Array(L);for(var T=0;T<g[_].length;T+=1)g[_][T]=255&n.getBuffer()[T+r];r+=L;var U=m.getErrorCorrectPolynomial(R),q=E(g[_],U.getLength()-1),st=q.mod(U);w[_]=new Array(U.getLength()-1);for(var T=0;T<w[_].length;T+=1){var lt=T+st.getLength()-w[_].length;w[_][T]=lt>=0?st.getAt(lt):0}}for(var dt=0,T=0;T<o.length;T+=1)dt+=o[T].totalCount;for(var et=new Array(dt),tt=0,T=0;T<i;T+=1)for(var _=0;_<o.length;_+=1)T<g[_].length&&(et[tt]=g[_][T],tt+=1);for(var T=0;T<s;T+=1)for(var _=0;_<o.length;_+=1)T<w[_].length&&(et[tt]=w[_][T],tt+=1);return et},Tt=function(n,o,r){for(var i=G.getRSBlocks(n,o),s=X(),g=0;g<r.length;g+=1){var w=r[g];s.put(w.getMode(),4),s.put(w.getLength(),m.getLengthInBits(w.getMode(),n)),w.write(s)}for(var _=0,g=0;g<i.length;g+=1)_+=i[g].dataCount;if(s.getLengthInBits()>_*8)throw"code length overflow. ("+s.getLengthInBits()+">"+_*8+")";for(s.getLengthInBits()+4<=_*8&&s.put(0,4);s.getLengthInBits()%8!=0;)s.putBit(!1);for(;!(s.getLengthInBits()>=_*8||(s.put(u,8),s.getLengthInBits()>=_*8));)s.put(h,8);return V(s,i)};f.addData=function(n,o){o=o||"Byte";var r=null;switch(o){case"Numeric":r=W(n);break;case"Alphanumeric":r=xt(n);break;case"Byte":r=yt(n);break;case"Kanji":r=_t(n);break;default:throw"mode:"+o}l.push(r),v=null},f.isDark=function(n,o){if(n<0||t<=n||o<0||t<=o)throw n+","+o;return e[n][o]},f.getModuleCount=function(){return t},f.make=function(){if(a<1){for(var n=1;n<40;n++){for(var o=G.getRSBlocks(n,p),r=X(),i=0;i<l.length;i++){var s=l[i];r.put(s.getMode(),4),r.put(s.getLength(),m.getLengthInBits(s.getMode(),n)),s.write(r)}for(var g=0,i=0;i<o.length;i++)g+=o[i].dataCount;if(r.getLengthInBits()<=g*8)break}a=n}A(!1,D())},f.createTableTag=function(n,o){n=n||2,o=typeof o>"u"?n*4:o;var r="";r+='<table style="',r+=" border-width: 0px; border-style: none;",r+=" border-collapse: collapse;",r+=" padding: 0px; margin: "+o+"px;",r+='">',r+="<tbody>";for(var i=0;i<f.getModuleCount();i+=1){r+="<tr>";for(var s=0;s<f.getModuleCount();s+=1)r+='<td style="',r+=" border-width: 0px; border-style: none;",r+=" border-collapse: collapse;",r+=" padding: 0px; margin: 0px;",r+=" width: "+n+"px;",r+=" height: "+n+"px;",r+=" background-color: ",r+=f.isDark(i,s)?"#000000":"#ffffff",r+=";",r+='"/>';r+="</tr>"}return r+="</tbody>",r+="</table>",r},f.createSvgTag=function(n,o,r,i){var s={};typeof arguments[0]=="object"&&(s=arguments[0],n=s.cellSize,o=s.margin,r=s.alt,i=s.title),n=n||2,o=typeof o>"u"?n*4:o,r=typeof r=="string"?{text:r}:r||{},r.text=r.text||null,r.id=r.text?r.id||"qrcode-description":null,i=typeof i=="string"?{text:i}:i||{},i.text=i.text||null,i.id=i.text?i.id||"qrcode-title":null;var g=f.getModuleCount()*n+o*2,w,_,L,R,T="",U;for(U="l"+n+",0 0,"+n+" -"+n+",0 0,-"+n+"z ",T+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',T+=s.scalable?"":' width="'+g+'px" height="'+g+'px"',T+=' viewBox="0 0 '+g+" "+g+'" ',T+=' preserveAspectRatio="xMinYMin meet"',T+=i.text||r.text?' role="img" aria-labelledby="'+Z([i.id,r.id].join(" ").trim())+'"':"",T+=">",T+=i.text?'<title id="'+Z(i.id)+'">'+Z(i.text)+"</title>":"",T+=r.text?'<description id="'+Z(r.id)+'">'+Z(r.text)+"</description>":"",T+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',T+='<path d="',L=0;L<f.getModuleCount();L+=1)for(R=L*n+o,w=0;w<f.getModuleCount();w+=1)f.isDark(L,w)&&(_=w*n+o,T+="M"+_+","+R+U);return T+='" stroke="transparent" fill="black"/>',T+="</svg>",T},f.createDataURL=function(n,o){n=n||2,o=typeof o>"u"?n*4:o;var r=f.getModuleCount()*n+o*2,i=o,s=r-o;return $t(r,r,function(g,w){if(i<=g&&g<s&&i<=w&&w<s){var _=Math.floor((g-i)/n),L=Math.floor((w-i)/n);return f.isDark(L,_)?0:1}else return 1})},f.createImgTag=function(n,o,r){n=n||2,o=typeof o>"u"?n*4:o;var i=f.getModuleCount()*n+o*2,s="";return s+="<img",s+=' src="',s+=f.createDataURL(n,o),s+='"',s+=' width="',s+=i,s+='"',s+=' height="',s+=i,s+='"',r&&(s+=' alt="',s+=Z(r),s+='"'),s+="/>",s};var Z=function(n){for(var o="",r=0;r<n.length;r+=1){var i=n.charAt(r);switch(i){case"<":o+="&lt;";break;case">":o+="&gt;";break;case"&":o+="&amp;";break;case'"':o+="&quot;";break;default:o+=i;break}}return o},At=function(n){var o=1;n=typeof n>"u"?o*2:n;var r=f.getModuleCount()*o+n*2,i=n,s=r-n,g,w,_,L,R,T={"██":"█","█ ":"▀"," █":"▄","  ":" "},U={"██":"▀","█ ":"▀"," █":" ","  ":" "},q="";for(g=0;g<r;g+=2){for(_=Math.floor((g-i)/o),L=Math.floor((g+1-i)/o),w=0;w<r;w+=1)R="█",i<=w&&w<s&&i<=g&&g<s&&f.isDark(_,Math.floor((w-i)/o))&&(R=" "),i<=w&&w<s&&i<=g+1&&g+1<s&&f.isDark(L,Math.floor((w-i)/o))?R+=" ":R+="█",q+=n<1&&g+1>=s?U[R]:T[R];q+=`
`}return r%2&&n>0?q.substring(0,q.length-r-1)+Array(r+1).join("▀"):q.substring(0,q.length-1)};return f.createASCII=function(n,o){if(n=n||1,n<2)return At(o);n-=1,o=typeof o>"u"?n*2:o;var r=f.getModuleCount()*n+o*2,i=o,s=r-o,g,w,_,L,R=Array(n+1).join("██"),T=Array(n+1).join("  "),U="",q="";for(g=0;g<r;g+=1){for(_=Math.floor((g-i)/n),q="",w=0;w<r;w+=1)L=1,i<=w&&w<s&&i<=g&&g<s&&f.isDark(_,Math.floor((w-i)/n))&&(L=0),q+=L?R:T;for(_=0;_<n;_+=1)U+=q+`
`}return U.substring(0,U.length-1)},f.renderTo2dContext=function(n,o){o=o||2;for(var r=f.getModuleCount(),i=0;i<r;i++)for(var s=0;s<r;s++)n.fillStyle=f.isDark(i,s)?"black":"white",n.fillRect(s*o,i*o,o,o)},f};c.stringToBytesFuncs={default:function(b){for(var x=[],u=0;u<b.length;u+=1){var h=b.charCodeAt(u);x.push(h&255)}return x}},c.stringToBytes=c.stringToBytesFuncs.default,c.createStringToBytes=function(b,x){var u=(function(){for(var a=mt(b),p=function(){var P=a.read();if(P==-1)throw"eof";return P},e=0,t={};;){var v=a.read();if(v==-1)break;var l=p(),f=p(),A=p(),C=String.fromCharCode(v<<8|l),D=f<<8|A;t[C]=D,e+=1}if(e!=x)throw e+" != "+x;return t})(),h=63;return function(a){for(var p=[],e=0;e<a.length;e+=1){var t=a.charCodeAt(e);if(t<128)p.push(t);else{var v=u[a.charAt(e)];typeof v=="number"?(v&255)==v?p.push(v):(p.push(v>>>8),p.push(v&255)):p.push(h)}}return p}};var y={MODE_NUMBER:1,MODE_ALPHA_NUM:2,MODE_8BIT_BYTE:4,MODE_KANJI:8},k={L:1,M:0,Q:3,H:2},d={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7},m=(function(){var b=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],x=1335,u=7973,h=21522,a={},p=function(e){for(var t=0;e!=0;)t+=1,e>>>=1;return t};return a.getBCHTypeInfo=function(e){for(var t=e<<10;p(t)-p(x)>=0;)t^=x<<p(t)-p(x);return(e<<10|t)^h},a.getBCHTypeNumber=function(e){for(var t=e<<12;p(t)-p(u)>=0;)t^=u<<p(t)-p(u);return e<<12|t},a.getPatternPosition=function(e){return b[e-1]},a.getMaskFunction=function(e){switch(e){case d.PATTERN000:return function(t,v){return(t+v)%2==0};case d.PATTERN001:return function(t,v){return t%2==0};case d.PATTERN010:return function(t,v){return v%3==0};case d.PATTERN011:return function(t,v){return(t+v)%3==0};case d.PATTERN100:return function(t,v){return(Math.floor(t/2)+Math.floor(v/3))%2==0};case d.PATTERN101:return function(t,v){return t*v%2+t*v%3==0};case d.PATTERN110:return function(t,v){return(t*v%2+t*v%3)%2==0};case d.PATTERN111:return function(t,v){return(t*v%3+(t+v)%2)%2==0};default:throw"bad maskPattern:"+e}},a.getErrorCorrectPolynomial=function(e){for(var t=E([1],0),v=0;v<e;v+=1)t=t.multiply(E([1,$.gexp(v)],0));return t},a.getLengthInBits=function(e,t){if(1<=t&&t<10)switch(e){case y.MODE_NUMBER:return 10;case y.MODE_ALPHA_NUM:return 9;case y.MODE_8BIT_BYTE:return 8;case y.MODE_KANJI:return 8;default:throw"mode:"+e}else if(t<27)switch(e){case y.MODE_NUMBER:return 12;case y.MODE_ALPHA_NUM:return 11;case y.MODE_8BIT_BYTE:return 16;case y.MODE_KANJI:return 10;default:throw"mode:"+e}else if(t<41)switch(e){case y.MODE_NUMBER:return 14;case y.MODE_ALPHA_NUM:return 13;case y.MODE_8BIT_BYTE:return 16;case y.MODE_KANJI:return 12;default:throw"mode:"+e}else throw"type:"+t},a.getLostPoint=function(e){for(var t=e.getModuleCount(),v=0,l=0;l<t;l+=1)for(var f=0;f<t;f+=1){for(var A=0,C=e.isDark(l,f),D=-1;D<=1;D+=1)if(!(l+D<0||t<=l+D))for(var P=-1;P<=1;P+=1)f+P<0||t<=f+P||D==0&&P==0||C==e.isDark(l+D,f+P)&&(A+=1);A>5&&(v+=3+A-5)}for(var l=0;l<t-1;l+=1)for(var f=0;f<t-1;f+=1){var F=0;e.isDark(l,f)&&(F+=1),e.isDark(l+1,f)&&(F+=1),e.isDark(l,f+1)&&(F+=1),e.isDark(l+1,f+1)&&(F+=1),(F==0||F==4)&&(v+=3)}for(var l=0;l<t;l+=1)for(var f=0;f<t-6;f+=1)e.isDark(l,f)&&!e.isDark(l,f+1)&&e.isDark(l,f+2)&&e.isDark(l,f+3)&&e.isDark(l,f+4)&&!e.isDark(l,f+5)&&e.isDark(l,f+6)&&(v+=40);for(var f=0;f<t;f+=1)for(var l=0;l<t-6;l+=1)e.isDark(l,f)&&!e.isDark(l+1,f)&&e.isDark(l+2,f)&&e.isDark(l+3,f)&&e.isDark(l+4,f)&&!e.isDark(l+5,f)&&e.isDark(l+6,f)&&(v+=40);for(var Q=0,f=0;f<t;f+=1)for(var l=0;l<t;l+=1)e.isDark(l,f)&&(Q+=1);var Y=Math.abs(100*Q/t/t-50)/5;return v+=Y*10,v},a})(),$=(function(){for(var b=new Array(256),x=new Array(256),u=0;u<8;u+=1)b[u]=1<<u;for(var u=8;u<256;u+=1)b[u]=b[u-4]^b[u-5]^b[u-6]^b[u-8];for(var u=0;u<255;u+=1)x[b[u]]=u;var h={};return h.glog=function(a){if(a<1)throw"glog("+a+")";return x[a]},h.gexp=function(a){for(;a<0;)a+=255;for(;a>=256;)a-=255;return b[a]},h})();function E(b,x){if(typeof b.length>"u")throw b.length+"/"+x;var u=(function(){for(var a=0;a<b.length&&b[a]==0;)a+=1;for(var p=new Array(b.length-a+x),e=0;e<b.length-a;e+=1)p[e]=b[e+a];return p})(),h={};return h.getAt=function(a){return u[a]},h.getLength=function(){return u.length},h.multiply=function(a){for(var p=new Array(h.getLength()+a.getLength()-1),e=0;e<h.getLength();e+=1)for(var t=0;t<a.getLength();t+=1)p[e+t]^=$.gexp($.glog(h.getAt(e))+$.glog(a.getAt(t)));return E(p,0)},h.mod=function(a){if(h.getLength()-a.getLength()<0)return h;for(var p=$.glog(h.getAt(0))-$.glog(a.getAt(0)),e=new Array(h.getLength()),t=0;t<h.getLength();t+=1)e[t]=h.getAt(t);for(var t=0;t<a.getLength();t+=1)e[t]^=$.gexp($.glog(a.getAt(t))+p);return E(e,0).mod(a)},h}var G=(function(){var b=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],x=function(a,p){var e={};return e.totalCount=a,e.dataCount=p,e},u={},h=function(a,p){switch(p){case k.L:return b[(a-1)*4+0];case k.M:return b[(a-1)*4+1];case k.Q:return b[(a-1)*4+2];case k.H:return b[(a-1)*4+3];default:return}};return u.getRSBlocks=function(a,p){var e=h(a,p);if(typeof e>"u")throw"bad rs block @ typeNumber:"+a+"/errorCorrectionLevel:"+p;for(var t=e.length/3,v=[],l=0;l<t;l+=1)for(var f=e[l*3+0],A=e[l*3+1],C=e[l*3+2],D=0;D<f;D+=1)v.push(x(A,C));return v},u})(),X=function(){var b=[],x=0,u={};return u.getBuffer=function(){return b},u.getAt=function(h){var a=Math.floor(h/8);return(b[a]>>>7-h%8&1)==1},u.put=function(h,a){for(var p=0;p<a;p+=1)u.putBit((h>>>a-p-1&1)==1)},u.getLengthInBits=function(){return x},u.putBit=function(h){var a=Math.floor(x/8);b.length<=a&&b.push(0),h&&(b[a]|=128>>>x%8),x+=1},u},W=function(b){var x=y.MODE_NUMBER,u=b,h={};h.getMode=function(){return x},h.getLength=function(e){return u.length},h.write=function(e){for(var t=u,v=0;v+2<t.length;)e.put(a(t.substring(v,v+3)),10),v+=3;v<t.length&&(t.length-v==1?e.put(a(t.substring(v,v+1)),4):t.length-v==2&&e.put(a(t.substring(v,v+2)),7))};var a=function(e){for(var t=0,v=0;v<e.length;v+=1)t=t*10+p(e.charAt(v));return t},p=function(e){if("0"<=e&&e<="9")return e.charCodeAt(0)-48;throw"illegal char :"+e};return h},xt=function(b){var x=y.MODE_ALPHA_NUM,u=b,h={};h.getMode=function(){return x},h.getLength=function(p){return u.length},h.write=function(p){for(var e=u,t=0;t+1<e.length;)p.put(a(e.charAt(t))*45+a(e.charAt(t+1)),11),t+=2;t<e.length&&p.put(a(e.charAt(t)),6)};var a=function(p){if("0"<=p&&p<="9")return p.charCodeAt(0)-48;if("A"<=p&&p<="Z")return p.charCodeAt(0)-65+10;switch(p){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+p}};return h},yt=function(b){var x=y.MODE_8BIT_BYTE,u=c.stringToBytes(b),h={};return h.getMode=function(){return x},h.getLength=function(a){return u.length},h.write=function(a){for(var p=0;p<u.length;p+=1)a.put(u[p],8)},h},_t=function(b){var x=y.MODE_KANJI,u=c.stringToBytesFuncs.SJIS;if(!u)throw"sjis not supported.";(function(p,e){var t=u(p);if(t.length!=2||(t[0]<<8|t[1])!=e)throw"sjis not supported."})("友",38726);var h=u(b),a={};return a.getMode=function(){return x},a.getLength=function(p){return~~(h.length/2)},a.write=function(p){for(var e=h,t=0;t+1<e.length;){var v=(255&e[t])<<8|255&e[t+1];if(33088<=v&&v<=40956)v-=33088;else if(57408<=v&&v<=60351)v-=49472;else throw"illegal char at "+(t+1)+"/"+v;v=(v>>>8&255)*192+(v&255),p.put(v,13),t+=2}if(t<e.length)throw"illegal char at "+(t+1)},a},it=function(){var b=[],x={};return x.writeByte=function(u){b.push(u&255)},x.writeShort=function(u){x.writeByte(u),x.writeByte(u>>>8)},x.writeBytes=function(u,h,a){h=h||0,a=a||u.length;for(var p=0;p<a;p+=1)x.writeByte(u[p+h])},x.writeString=function(u){for(var h=0;h<u.length;h+=1)x.writeByte(u.charCodeAt(h))},x.toByteArray=function(){return b},x.toString=function(){var u="";u+="[";for(var h=0;h<b.length;h+=1)h>0&&(u+=","),u+=b[h];return u+="]",u},x},wt=function(){var b=0,x=0,u=0,h="",a={},p=function(t){h+=String.fromCharCode(e(t&63))},e=function(t){if(!(t<0)){if(t<26)return 65+t;if(t<52)return 97+(t-26);if(t<62)return 48+(t-52);if(t==62)return 43;if(t==63)return 47}throw"n:"+t};return a.writeByte=function(t){for(b=b<<8|t&255,x+=8,u+=1;x>=6;)p(b>>>x-6),x-=6},a.flush=function(){if(x>0&&(p(b<<6-x),b=0,x=0),u%3!=0)for(var t=3-u%3,v=0;v<t;v+=1)h+="="},a.toString=function(){return h},a},mt=function(b){var x=b,u=0,h=0,a=0,p={};p.read=function(){for(;a<8;){if(u>=x.length){if(a==0)return-1;throw"unexpected end of file./"+a}var t=x.charAt(u);if(u+=1,t=="=")return a=0,-1;if(t.match(/^\s$/))continue;h=h<<6|e(t.charCodeAt(0)),a+=6}var v=h>>>a-8&255;return a-=8,v};var e=function(t){if(65<=t&&t<=90)return t-65;if(97<=t&&t<=122)return t-97+26;if(48<=t&&t<=57)return t-48+52;if(t==43)return 62;if(t==47)return 63;throw"c:"+t};return p},kt=function(b,x){var u=b,h=x,a=new Array(b*x),p={};p.setPixel=function(l,f,A){a[f*u+l]=A},p.write=function(l){l.writeString("GIF87a"),l.writeShort(u),l.writeShort(h),l.writeByte(128),l.writeByte(0),l.writeByte(0),l.writeByte(0),l.writeByte(0),l.writeByte(0),l.writeByte(255),l.writeByte(255),l.writeByte(255),l.writeString(","),l.writeShort(0),l.writeShort(0),l.writeShort(u),l.writeShort(h),l.writeByte(0);var f=2,A=t(f);l.writeByte(f);for(var C=0;A.length-C>255;)l.writeByte(255),l.writeBytes(A,C,255),C+=255;l.writeByte(A.length-C),l.writeBytes(A,C,A.length-C),l.writeByte(0),l.writeString(";")};var e=function(l){var f=l,A=0,C=0,D={};return D.write=function(P,F){if(P>>>F)throw"length over";for(;A+F>=8;)f.writeByte(255&(P<<A|C)),F-=8-A,P>>>=8-A,C=0,A=0;C=P<<A|C,A=A+F},D.flush=function(){A>0&&f.writeByte(C)},D},t=function(l){for(var f=1<<l,A=(1<<l)+1,C=l+1,D=v(),P=0;P<f;P+=1)D.add(String.fromCharCode(P));D.add(String.fromCharCode(f)),D.add(String.fromCharCode(A));var F=it(),Q=e(F);Q.write(f,C);var Y=0,J=String.fromCharCode(a[Y]);for(Y+=1;Y<a.length;){var V=String.fromCharCode(a[Y]);Y+=1,D.contains(J+V)?J=J+V:(Q.write(D.indexOf(J),C),D.size()<4095&&(D.size()==1<<C&&(C+=1),D.add(J+V)),J=V)}return Q.write(D.indexOf(J),C),Q.write(A,C),Q.flush(),F.toByteArray()},v=function(){var l={},f=0,A={};return A.add=function(C){if(A.contains(C))throw"dup key:"+C;l[C]=f,f+=1},A.size=function(){return f},A.indexOf=function(C){return l[C]},A.contains=function(C){return typeof l[C]<"u"},A};return p},$t=function(b,x,u){for(var h=kt(b,x),a=0;a<x;a+=1)for(var p=0;p<b;p+=1)h.setPixel(p,a,u(p,a));var e=it();h.write(e);for(var t=wt(),v=e.toByteArray(),l=0;l<v.length;l+=1)t.writeByte(v[l]);return t.flush(),"data:image/gif;base64,"+t};return c})();(function(){bt.stringToBytesFuncs["UTF-8"]=function(c){function y(k){for(var d=[],m=0;m<k.length;m++){var $=k.charCodeAt(m);$<128?d.push($):$<2048?d.push(192|$>>6,128|$&63):$<55296||$>=57344?d.push(224|$>>12,128|$>>6&63,128|$&63):(m++,$=65536+(($&1023)<<10|k.charCodeAt(m)&1023),d.push(240|$>>18,128|$>>12&63,128|$>>6&63,128|$&63))}return d}return y(c)}})();var Ft=Object.defineProperty,St=Object.getOwnPropertyDescriptor,ot=(c,y,k,d)=>{for(var m=d>1?void 0:d?St(y,k):y,$=c.length-1,E;$>=0;$--)(E=c[$])&&(m=(d?E(y,k,m):E(m))||m);return d&&m&&Ft(y,k,m),m};let z=class extends at{constructor(){super(...arguments),this.tabs=[],this.activeIndex=0}_handleClick(c){c!==this.activeIndex&&(this.activeIndex=c,this.dispatchEvent(new CustomEvent("tab-change",{detail:{index:c},bubbles:!0,composed:!0})))}render(){return M`
      <div class="pill-group">
        ${this.tabs.map((c,y)=>M`
            <button class=${y===this.activeIndex?"active":""} @click=${()=>this._handleClick(y)}>
              ${c}
            </button>
          `)}
      </div>
    `}};z.styles=rt`
    :host {
      display: flex;
      justify-content: center;
      padding: 12px 16px;
    }

    .pill-group {
      display: inline-flex;
      background: var(--border-subtle);
      border-radius: var(--radius-pill);
      padding: 3px;
    }

    button {
      padding: 7px 18px;
      text-align: center;
      border-radius: var(--radius-pill);
      border: none;
      background: transparent;
      color: var(--text-secondary);
      font-size: var(--font-md);
      font-weight: 500;
      cursor: pointer;
      letter-spacing: 0.3px;
      transition: background var(--transition-fast), color var(--transition-fast);
      font-family: inherit;
      white-space: nowrap;
    }

    button.active {
      background: var(--surface);
      color: var(--text);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
    }
  `;ot([N({type:Array})],z.prototype,"tabs",2);ot([N({type:Number})],z.prototype,"activeIndex",2);z=ot([nt("nav-tabs")],z);var Ut=Object.defineProperty,qt=Object.getOwnPropertyDescriptor,O=(c,y,k,d)=>{for(var m=d>1?void 0:d?qt(y,k):y,$=c.length-1,E;$>=0;$--)(E=c[$])&&(m=(d?E(y,k,m):E(m))||m);return d&&m&&Ut(y,k,m),m};let I=class extends at{constructor(){super(...arguments),this.name="",this.typeLabel="",this.meta="",this.status="stopped",this.endpoint="",this.currentConns=0,this.totalConns=0,this.requestRate=0,this.inputBytes=0,this.outputBytes=0,this.inputRate=0,this.outputRate=0,this.createdAt="",this.expanded=!1,this.compact=!0,this.error=""}_onRowClick(){this.dispatchEvent(new CustomEvent("card-click",{bubbles:!0,composed:!0}))}_onChevronClick(c){c.stopPropagation(),this.dispatchEvent(new CustomEvent("chevron-click",{bubbles:!0,composed:!0}))}render(){const c=this.status==="stopped";return M`
      <div class="row ${c?"stopped":""}" @click=${this._onRowClick}>
        <span class="dot ${this.status}"></span>

        <div class="info">
          <div class="name">${this.name}</div>
          ${this.typeLabel?M`<div class="type-label">${this.typeLabel}</div>`:""}
          ${this.meta?M`<div class="meta">${this.meta}</div>`:""}
        </div>

        <div class="right-col">
          ${this.createdAt?M`<span class="created-at">${Nt(this.createdAt)}</span>`:""}
          ${this.status==="running"?M`
            <div class="traffic">
              <div class="traffic-row">
                <span class="traffic-total">${ht(this.inputBytes)}</span>
                <span>↑ ${gt(this.inputRate)}</span>
              </div>
              <div class="traffic-row">
                <span class="traffic-total">${ht(this.outputBytes)}</span>
                <span>↓ ${gt(this.outputRate)}</span>
              </div>
            </div>
          `:""}
        </div>

        <span class="chevron ${this.expanded?"open":""}" @click=${this._onChevronClick}>
          ${j("chevron-right")}
        </span>
      </div>

      ${this.error?M`<div class="error-banner">${this.error}</div>`:""}
    `}};I.styles=rt`
    :host {
      display: block;
    }

    .row {
      display: flex;
      align-items: flex-start;
      padding: 8px 12px;
      background: var(--border-subtle);
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: background var(--transition-fast);
      gap: 10px;
    }

    .row:hover {
      background: var(--border);
    }

    .row.stopped {
      opacity: 0.55;
    }

    /* ── Status dot ── */
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--text-muted);
      align-self: center;
    }

    .dot.running {
      background: var(--green);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.3);
    }

    .dot.error {
      background: var(--red);
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
    }

    /* ── Info column ── */
    .info {
      flex: 1;
      min-width: 0;
      align-self: stretch;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
    }

    .name {
      font-size: var(--font-md);
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .type-label,
    .meta {
      font-size: var(--font-sm);
      color: var(--text-muted);
    }

    /* ── Right column: created-at + traffic ── */
    .right-col {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      min-width: 60px;
      align-self: center;
    }

    .created-at {
      font-size: var(--font-sm);
      color: var(--text-muted);
      text-align: right;
      line-height: 1.4;
    }

    /* ── Traffic stats ── */
    .traffic {
      text-align: right;
      font-size: var(--font-sm);
      color: var(--text);
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    .traffic-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 2px;
    }

    .traffic-total {
      color: var(--text-secondary);
      font-size: var(--font-sm);
    }

    /* ── Chevron ── */
    .chevron {
      flex-shrink: 0;
      color: var(--text-muted);
      transition: transform var(--transition-fast);
      display: flex;
      align-items: center;
      justify-content: center;
      align-self: stretch;
      padding: 0 8px;
      margin: -8px -12px;
      margin-left: 0;
    }

    .chevron.open {
      transform: rotate(90deg);
    }

    /* ── Error ── */
    .error-banner {
      padding: 5px 14px 5px 34px;
      background: var(--red-bg);
      border-radius: var(--radius-sm);
      margin-top: 2px;
      font-size: var(--font-sm);
      color: var(--red-text);
    }
  `;O([N()],I.prototype,"name",2);O([N()],I.prototype,"typeLabel",2);O([N()],I.prototype,"meta",2);O([N()],I.prototype,"status",2);O([N()],I.prototype,"endpoint",2);O([N({type:Number})],I.prototype,"currentConns",2);O([N({type:Number})],I.prototype,"totalConns",2);O([N({type:Number})],I.prototype,"requestRate",2);O([N({type:Number})],I.prototype,"inputBytes",2);O([N({type:Number})],I.prototype,"outputBytes",2);O([N({type:Number})],I.prototype,"inputRate",2);O([N({type:Number})],I.prototype,"outputRate",2);O([N()],I.prototype,"createdAt",2);O([N({type:Boolean})],I.prototype,"expanded",2);O([N({type:Boolean})],I.prototype,"compact",2);O([N()],I.prototype,"error",2);I=O([nt("tunnel-card")],I);var jt=Object.defineProperty,Ht=Object.getOwnPropertyDescriptor,H=(c,y,k,d)=>{for(var m=d>1?void 0:d?Ht(y,k):y,$=c.length-1,E;$>=0;$--)(E=c[$])&&(m=(d?E(y,k,m):E(m))||m);return d&&m&&jt(y,k,m),m};let S=class extends at{constructor(){super(...arguments),this._activeTab=0,this.showFavorites=!1,this._tunnels=[],this._entrypoints=[],this._tunnelsLoading=!1,this._entrypointsLoading=!1,this._expandedId=null,this._unsubs=[],this._snackbar="",this._deleteTarget=null,this._qrUrl=""}connectedCallback(){super.connectedCallback(),this._tunnels=ut(),this._entrypoints=ft(),this._tunnelsLoading=pt(),this._entrypointsLoading=ct(),this._unsubs.push(Ct(()=>{this._tunnels=ut(),this._tunnelsLoading=pt(),this.requestUpdate()}),Bt(()=>{this._entrypoints=ft(),this._entrypointsLoading=ct(),this.requestUpdate()}),Et(()=>this.requestUpdate()))}disconnectedCallback(){super.disconnectedCallback();for(const c of this._unsubs)c();this._unsubs=[]}_navigate(c){window.history.pushState({},"",c),window.dispatchEvent(new PopStateEvent("popstate"))}_toggleFavorites(){this.showFavorites=!this.showFavorites,this._expandedId=null}_toggleExpand(c){this._expandedId=this._expandedId===c?null:c}get _filteredTunnels(){return[...this.showFavorites?this._tunnels.filter(y=>y.favorite):this._tunnels].sort((y,k)=>new Date(k.created_at).getTime()-new Date(y.created_at).getTime())}get _filteredEntrypoints(){return[...this.showFavorites?this._entrypoints.filter(y=>y.favorite):this._entrypoints].sort((y,k)=>new Date(k.created_at).getTime()-new Date(y.created_at).getTime())}get _items(){return this._activeTab===0?this._filteredTunnels.map(c=>({kind:"tunnel",data:c})):this._filteredEntrypoints.map(c=>({kind:"entrypoint",data:c}))}_isLoading(){return this._activeTab===0?this._tunnelsLoading:this._entrypointsLoading}_statusLabel(c){switch(c){case"running":return B("statusRunning");case"stopped":return B("statusStopped");case"error":return B("statusError")}}_metaLine(c){return c.data.status==="running"?`${Ot(c.data.stats.current_conns)} ${B("conns")}`:this._statusLabel(c.data.status)}_typeLabel(c){return c.data.type.toUpperCase()}_renderEmptyState(){const c=this._activeTab===0,y=c?this._tunnels.length===0:this._entrypoints.length===0;if(this.showFavorites)return M`
        <div class="empty">
          <div class="empty-icon-wrap">${j("star")}</div>
          <div class="empty-title">${B("homeNoFavorites")}</div>
          <div class="empty-desc">${c?B("homeNoFavTunnelHint"):B("homeNoFavEntryHint")}</div>
          <button class="empty-sub-link" @click=${this._toggleFavorites}>
            ${c?B("homeShowAllTunnels"):B("homeShowAllEntrypoints")}
          </button>
        </div>
      `;if(y){const k=c?"/tunnel/new":"/entrypoint/new";return M`
        <div class="empty">
          <div class="empty-icon-wrap">${j(c?"link":"broadcast")}</div>
          <div class="empty-title">${c?B("homeEmptyTunnels"):B("homeEmptyEntrypoints")}</div>
          <div class="empty-desc">${c?B("homeEmptyTunnelDesc"):B("homeEmptyEntryDesc")}</div>
          <button class="empty-action" @click=${()=>this._navigate(k)}>
            ${c?B("tunnelNewTitle"):B("entrypointNewTitle")}
          </button>
        </div>
      `}return M``}_showSnackbar(c){this._snackbar=c,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleStart(c){try{c.kind==="tunnel"?await Dt(c.data.id):await Lt(c.data.id),this._showSnackbar(B("started"))}catch{this._showSnackbar(B("startFailed"))}}async _handleStop(c){try{c.kind==="tunnel"?await Mt(c.data.id):await Pt(c.data.id),this._showSnackbar(B("stopped"))}catch{this._showSnackbar(B("stopFailed"))}}_confirmDelete(c,y,k){this._deleteTarget={kind:c,id:y,name:k}}async _handleDelete(){if(!this._deleteTarget)return;const{kind:c,id:y}=this._deleteTarget;this._deleteTarget=null;try{c==="tunnel"?await vt(()=>import("./index-DObwXlqC.js").then(k=>k.D),__vite__mapDeps([0,1])).then(k=>k.remove(y)):await vt(()=>import("./index-DObwXlqC.js").then(k=>k.E),__vite__mapDeps([0,1])).then(k=>k.remove(y)),this._expandedId=null,this._showSnackbar(B("deleted"))}catch{this._showSnackbar(B("deleteFailed"))}}_openQrDialog(c){this._qrUrl=c}_closeQrDialog(){this._qrUrl=""}updated(c){if(c.has("_qrUrl")&&this._qrUrl){const y=this.renderRoot.querySelector("#qrCanvas");this._renderQrCanvas(y,this._qrUrl)}}_renderQrCanvas(c,y){if(c)try{const k=bt(0,"M");k.addData(y),k.make();const d=k.getModuleCount(),m=4,$=4,E=d*m+$*2;c.width=E,c.height=E;const G=c.getContext("2d");if(!G)return;G.fillStyle="#fff",G.fillRect(0,0,E,E),G.fillStyle="#000";for(let X=0;X<d;X++)for(let W=0;W<d;W++)k.isDark(X,W)&&G.fillRect($+W*m,$+X*m,m,m)}catch(k){console.warn("QR render failed:",k)}}render(){const c=this._items,y=this._isLoading(),k=this._activeTab===0?"/tunnel/new":"/entrypoint/new";return M`
      <app-scaffold>
        <!-- Appbar -->
        <div slot="appBar" class="home-header">
          <div class="app-icon">
            <img src="/logo.png" alt="Wisper" />
          </div>
          <span class="appbar-title">${B("appName")}</span>
          <span class="header-spacer"></span>
          <button class="icon-btn" @click=${()=>this._navigate("/settings")}>
            ${j("settings")}
          </button>
        </div>

        <!-- Tabs -->
        <nav-tabs
          .tabs=${[B("homeTabTunnel"),B("homeTabEntrypoint")]}
          .activeIndex=${this._activeTab}
          @tab-change=${d=>{this._activeTab=d.detail.index,this._expandedId=null}}
        ></nav-tabs>

        <!-- Body -->
        ${y?M`<div class="loading"><wisper-spinner></wisper-spinner></div>`:c.length===0?this._renderEmptyState():M`
              <div class="list">
                ${c.map(d=>{const m=d.kind==="tunnel"?`/tunnel/${d.data.type}/${d.data.id}`:`/entrypoint/${d.data.type}/${d.data.id}`,$=this._expandedId===d.data.id;return M`
                    <div>
                      <tunnel-card
                        .name=${d.data.name}
                        .typeLabel=${this._typeLabel(d)}
                        .meta=${this._metaLine(d)}
                        .status=${d.data.status}
                        .endpoint=${d.data.endpoint}
                        .error=${d.data.error}
                        .createdAt=${d.data.created_at}
                        .currentConns=${d.data.stats.current_conns}
                        .totalConns=${d.data.stats.total_conns}
                        .requestRate=${d.data.stats.request_rate}
                        .inputBytes=${d.data.stats.input_bytes}
                        .outputBytes=${d.data.stats.output_bytes}
                        .inputRate=${d.data.stats.input_rate_bytes}
                        .outputRate=${d.data.stats.output_rate_bytes}
                        .expanded=${$}
                        .compact=${!0}
                        @card-click=${()=>this._navigate(m)}
                        @chevron-click=${()=>this._toggleExpand(d.data.id)}
                      ></tunnel-card>

                      ${$?M`
                          <div class="expand-panel">
                            <div class="detail-card">
                              <div class="detail-row">
                                <span class="dlabel">${d.kind==="tunnel"?"Entrypoint":"Endpoint"}</span>
                                <span class="dval">
                                  <a class="dval-link dval-mono" href="${d.data.entrypoint.startsWith("http")?d.data.entrypoint:"https://"+d.data.entrypoint}" target="_blank" rel="noopener">${d.data.entrypoint}</a>
                                  <button class="copy-btn-mini" @click=${async E=>{E.stopPropagation(),await It(d.data.entrypoint),this._showSnackbar(B("copiedToClipboard"))}}>
                                    ${j("copy")}
                                  </button>
                                </span>
                              </div>
                              <div class="detail-row">
                                <span class="dlabel">${d.kind==="tunnel"?"Target":"Bind"}</span>
                                <span class="dval"><span class="dval-mono">${d.data.endpoint}</span></span>
                              </div>
                              ${d.kind==="tunnel"&&d.data.options?.hostname?M`<div class="detail-row">
                                  <span class="dlabel">Host Rewrite</span>
                                  <span class="dval"><span class="dval-mono">${d.data.options.hostname}</span></span>
                                </div>`:""}
                              ${d.data.error?M`<div class="detail-row error"><span class="dlabel">Error</span><span class="dval error-text"><span class="dval-mono">${d.data.error}</span></span></div>`:""}
                            </div>
                            <div class="expand-actions">
                              ${d.data.status==="running"?M`
                                  <button class="action-btn stop" title="${B("btnStop")}" @click=${E=>{E.stopPropagation(),this._handleStop(d)}}>${j("stop")}</button>
                                `:M`
                                  <button class="action-btn start" title="${B("btnStart")}" @click=${E=>{E.stopPropagation(),this._handleStart(d)}}>${j("play")}</button>
                                `}
                              <button class="action-btn" title="${B("btnEdit")}" @click=${E=>{E.stopPropagation(),this._navigate(m+"?edit")}}>${j("edit")}</button>
                              <button class="action-btn danger" title="${B("btnDelete")}" @click=${E=>{E.stopPropagation(),this._confirmDelete(d.kind,d.data.id,d.data.name)}}>${j("trash")}</button>
                              ${d.data.entrypoint?M`<button class="action-btn qr" title="${B("qrCode")}" style="margin-left:auto;"
                                    @click=${E=>{E.stopPropagation(),this._openQrDialog(d.data.entrypoint)}}>
                                    ${j("qr")}
                                  </button>`:""}
                              ${d.kind==="tunnel"&&(d.data.type==="http"||d.data.type==="file")&&Rt().inspector_url?M`<button class="action-btn inspect" title="${B("inspectorEntryTitle")}"
                                    style="${d.data.entrypoint?"":"margin-left:auto;"}"
                                    @click=${E=>{E.stopPropagation(),this._navigate(`/tunnel/${d.data.type}/${d.data.id}/inspector`)}}>
                                    ${j("search")}
                                  </button>`:""}
                            </div>
                          </div>
                        `:""}
                    </div>
                  `})}
              </div>
            `}

        <!-- FAB -->
        <div slot="fab">
          <button class="fab" @click=${()=>this._navigate(k)}>
            ${j("plus")}
          </button>
        </div>
      </app-scaffold>

      ${this._snackbar?M`<div class="toast">${this._snackbar}</div>`:""}

      ${this._qrUrl?M`
          <div class="dialog-overlay" @click=${()=>this._closeQrDialog()}>
            <div class="dialog-box" @click=${d=>d.stopPropagation()}>
              <div class="dialog-title">${B("qrCode")}</div>
              <div class="qr-body">
                <canvas id="qrCanvas"></canvas>
                <div class="qr-url">${this._qrUrl}</div>
              </div>
              <div class="dialog-actions">
                <button class="dialog-btn cancel" @click=${()=>this._closeQrDialog()}>
                  ${B("btnClose")}
                </button>
              </div>
            </div>
          </div>
        `:""}

      ${this._deleteTarget?M`
          <div class="dialog-overlay" @click=${()=>{this._deleteTarget=null}}>
            <div class="dialog-box" @click=${d=>d.stopPropagation()}>
              <div class="dialog-title">${B("deleteConfirmTitle")}</div>
              <div class="dialog-message">${B("deleteConfirmMessage")}</div>
              <div class="dialog-actions">
                <button class="dialog-btn cancel" @click=${()=>{this._deleteTarget=null}}>
                  ${B("btnCancel")}
                </button>
                <button class="dialog-btn danger" @click=${this._handleDelete}>
                  ${B("btnDelete")}
                </button>
              </div>
            </div>
          </div>
        `:""}
    `}};S.styles=rt`
    /* ── Home header (inside appbar slot) ── */
    .home-header {
      display: flex;
      align-items: center;
      width: 100%;
      gap: 8px;
    }

    .app-icon {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .app-icon img {
      width: 16px;
      height: 16px;
      object-fit: contain;
      display: block;
    }

    .appbar-title {
      font-size: var(--font-md);
      font-weight: 600;
      color: var(--text);
    }

    .header-spacer {
      flex: 1;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast), color var(--transition-fast);
      width: 28px;
      height: 28px;
    }

    .icon-btn:hover {
      background: var(--border-subtle);
      color: var(--text);
    }

    .icon-btn.active {
      color: var(--amber);
    }

    /* ── List ── */
    .list {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px 16px 80px 16px;
    }

    /* ── Expand panel ── */
    .expand-panel {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .expand-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--font-sm);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      color: var(--text-secondary);
      word-break: break-all;
    }

    .expand-row .mono {
      flex: 1;
      color: var(--text);
    }

    .expand-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    .action-btn {
      padding: 5px 12px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      line-height: 1;
      cursor: pointer;
      font-family: inherit;
      transition: background var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .action-btn svg {
      width: 14px;
      height: 14px;
    }

    .action-btn:hover {
      background: var(--border-subtle);
    }

    .action-btn.start {
      background: var(--green);
      color: #fff;
      border-color: var(--green);
    }

    .action-btn.stop {
      background: var(--red);
      color: #fff;
      border-color: var(--red);
    }

    .action-btn.danger {
      color: var(--red);
      border-color: var(--red-border);
    }

    .expand-error {
      font-size: var(--font-sm);
      color: var(--red-text);
      padding: 4px 8px;
      background: var(--red-bg);
      border-radius: var(--radius-sm);
    }

    /* ── Expand detail card ── */
    .detail-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .detail-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-row .dlabel {
      color: var(--text-muted);
      font-size: var(--font-sm);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .detail-row .dval {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: var(--font-sm);
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .dval-mono {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-row.error {
      background: var(--red-bg);
    }
    .detail-row .error-text {
      color: var(--red-text);
    }
    .copy-btn-mini {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      color: var(--text-muted);
      display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover {
      background: var(--border-subtle);
      color: var(--text);
    }

    .dval-link {
      color: var(--accent);
      text-decoration: none;
    }
    .dval-link:hover {
      text-decoration: underline;
    }

    .action-btn.qr {
      color: var(--accent);
      border-color: var(--accent);
    }
    .action-btn.inspect {
      color: var(--accent);
      border-color: var(--accent);
    }

    .qr-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      margin: 16px 0;
    }
    .qr-body canvas {
      width: 200px;
      height: 200px;
      background: #fff;
      border-radius: var(--radius-sm);
      padding: 8px;
      box-sizing: border-box;
      image-rendering: pixelated;
    }
    .qr-url {
      font-size: var(--font-xs);
      color: var(--text-secondary);
      text-align: center;
      word-break: break-all;
      line-height: 1.4;
      max-width: 100%;
    }

    /* ── Empty state ── */
    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 40px;
      color: var(--text-muted);
      gap: 8px;
      text-align: center;
    }

    .empty-icon-wrap {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--surface);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;
      color: var(--text-muted);
    }

    .empty-title {
      font-weight: 600;
      font-size: var(--font-md);
      color: var(--text);
    }

    .empty-desc {
      font-size: var(--font-md);
      color: var(--text-secondary);
      max-width: 240px;
      line-height: 1.5;
      margin-bottom: 4px;
    }

    .empty-action {
      padding: 7px 18px;
      border-radius: var(--radius-md);
      border: none;
      background: var(--accent);
      color: var(--accent-fg);
      font-size: var(--font-md);
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity var(--transition-fast);
    }

    .empty-action:hover {
      opacity: 0.85;
    }

    .empty-sub-link {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: var(--font-sm);
      cursor: pointer;
      font-family: inherit;
      text-decoration: underline;
      padding: 4px 8px;
    }

    .empty-sub-link:hover {
      color: var(--text);
    }

    /* ── Loading ── */
    .loading {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    /* ── FAB ── */
    .fab {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.1s, opacity var(--transition-fast);
    }

    .fab:hover {
      opacity: 0.9;
    }

    .fab:active {
      transform: scale(0.96);
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--surface);
      color: var(--text);
      padding: 10px 20px;
      border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-size: var(--font-sm);
      z-index: 100;
      animation: toast-in 0.3s ease;
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-12px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    /* ── Delete dialog ── */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200;
      animation: fade-in 0.15s ease;
    }

    @keyframes fade-in {
      from { opacity: 0; }
    }

    .dialog-box {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      max-width: 320px;
      width: 90%;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    }

    .dialog-title {
      font-weight: 600;
      font-size: var(--font-md);
      margin-bottom: 8px;
      text-align: center;
    }

    .dialog-message {
      color: var(--text-secondary);
      font-size: var(--font-sm);
      margin-bottom: 20px;
      text-align: center;
      line-height: 1.5;
    }

    .dialog-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .dialog-btn {
      padding: 8px 20px;
      border-radius: var(--radius-pill);
      border: none;
      cursor: pointer;
      font-size: var(--font-sm);
      font-weight: 500;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .dialog-btn.cancel {
      background: var(--border-subtle);
      color: var(--text);
    }

    .dialog-btn.danger {
      background: var(--red);
      color: #fff;
    }

    .dialog-btn:hover {
      opacity: 0.85;
    }
  `;H([K()],S.prototype,"_activeTab",2);H([K()],S.prototype,"showFavorites",2);H([K()],S.prototype,"_tunnels",2);H([K()],S.prototype,"_entrypoints",2);H([K()],S.prototype,"_tunnelsLoading",2);H([K()],S.prototype,"_entrypointsLoading",2);H([K()],S.prototype,"_expandedId",2);H([K()],S.prototype,"_snackbar",2);H([K()],S.prototype,"_deleteTarget",2);H([K()],S.prototype,"_qrUrl",2);S=H([nt("home-page")],S);export{S as HomePage};
