import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
loadEnv(join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 3000);
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const API_KEY = process.env.OPENAI_API_KEY || '';
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe-diarize';
const EVAL_MODEL = process.env.OPENAI_EVAL_MODEL || 'gpt-5';
const rubric = JSON.parse(readFileSync(join(ROOT, 'config/rubric.json'), 'utf8'));

const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
function loadEnv(path){if(!existsSync(path)) return; for(const raw of readFileSync(path,'utf8').split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const i=line.indexOf('=');if(i<1)continue;const k=line.slice(0,i).trim();let v=line.slice(i+1).trim().replace(/^['"]|['"]$/g,'');if(!(k in process.env))process.env[k]=v;}}
function json(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':Buffer.byteLength(body)});res.end(body);}
async function jsonBody(req,limit=12*1024*1024){const parts=[];let n=0;for await(const c of req){n+=c.length;if(n>limit)throw new Error('요청이 너무 큽니다.');parts.push(c);}return parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')):{};}
function webRequest(req){const init={method:req.method,headers:req.headers};if(!['GET','HEAD'].includes(req.method)){init.body=Readable.toWeb(req);init.duplex='half';}return new Request(new URL(req.url,`http://${req.headers.host||'localhost'}`),init);}
function hhmm(sec){sec=Math.max(0,Number(sec||0));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}`;}
function outputText(data){if(typeof data.output_text==='string')return data.output_text;return (data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text||'').join('');}
function grade(score){return rubric.gradeBands.find(x=>score>=x.min)||rubric.gradeBands.at(-1);}
function clamp(n,max){return Math.max(0,Math.min(max,Math.round(Number(n)||0)));}

async function transcribe(req,res){
  if(!API_KEY)return json(res,503,{error:'OPENAI_API_KEY가 설정되지 않았습니다.'});
  try{
    const len=Number(req.headers['content-length']||0);if(len>MAX_MB*1024*1024)return json(res,413,{error:`업로드 한도 ${MAX_MB}MB를 초과했습니다.`});
    const form=await webRequest(req).formData();const audio=form.get('audio');
    if(!(audio instanceof File)||!audio.size)return json(res,400,{error:'오디오 또는 영상 파일이 필요합니다.'});
    const up=new FormData();up.append('file',audio,audio.name||'debate.webm');up.append('model',TRANSCRIBE_MODEL);up.append('response_format','diarized_json');up.append('chunking_strategy','auto');up.append('language','ko');
    const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{authorization:`Bearer ${API_KEY}`},body:up});const d=await r.json().catch(()=>({}));
    if(!r.ok)return json(res,r.status,{error:d?.error?.message||'전사 요청에 실패했습니다.'});
    const segments=(d.segments||[]).map((s,i)=>({id:s.id||`seg_${i+1}`,start:Number(s.start||0),end:Number(s.end||0),speaker:String(s.speaker||'?'),text:String(s.text||'').trim()}));
    json(res,200,{model:TRANSCRIBE_MODEL,duration:Number(d.duration||0),text:String(d.text||''),segments});
  }catch(e){console.error(e);json(res,500,{error:e.message||'전사 오류'});}
}

function makePrompt(p){
  const participants=(p.participants||[]).filter(x=>x?.name).map(x=>({name:String(x.name),side:x.side==='반대'?'반대':'찬성'}));
  const byName=new Map(participants.map(x=>[x.name,x]));const sm=p.speakerMap||{};
  const transcript=(p.segments||[]).slice(0,12000).map((s,i)=>{const name=sm[s.speaker]||s.speaker;return {n:i+1,time:`${hhmm(s.start)}-${hhmm(s.end)}`,speaker:s.speaker,name,side:byName.get(name)?.side||'미지정',text:String(s.text||'')};});
  return `당신은 한국어 토론을 평가하는 엄격한 심사위원이다.\n\n논제: ${p.topic||''}\n참가자: ${JSON.stringify(participants)}\n루브릭: ${JSON.stringify(rubric)}\n전사문: ${JSON.stringify(transcript)}\n\n규칙:\n1. 찬성/반대를 완전히 같은 기준으로 평가한다.\n2. 입론 40, 교차조사 35, 최종변론 25의 각 세부 기준 점수를 모두 제시한다.\n3. 모든 세부 항목에는 실제 전사문에 존재하는 발언을 evidence로 0~3개 제시한다. 확인할 근거가 없으면 evidence는 빈 배열이다.\n4. 전사문에서 확인할 수 없는 표정, 시선, 음량, 억양은 추정하지 않는다.\n5. 교차조사는 질문의 수가 아니라 핵심 쟁점 공격, 답변 활용, 후속 질문, 방어 능력을 본다.\n6. 최종변론은 단순 반복보다 쟁점 정리, 반박, 방어, 비교·형량을 중시한다.\n7. 근거 없는 고득점을 피하고 점수 이유를 구체적으로 적는다.\n8. JSON 이외의 텍스트는 출력하지 않는다.\n\n반환 JSON 형식:\n{\n "teams":[{\n   "side":"찬성", "sections":[{\n     "id":"opening", "summary":"", "criteria":[{"id":"opening_topic_position","score":0,"judgment":"","improvement":"","evidence":[{"time":"00:00-00:00","name":"","quote":""}]}]\n   }], "strengths":[""], "improvements":[""]\n }],\n "clashes":[{"issue":"","pro":"","con":"","assessment":""}],\n "participants":[{"name":"","side":"찬성","contribution":"","strength":"","improvement":""}],\n "overall_comment":""\n}`;}

function normalizeEvaluation(raw){
  const teams=['찬성','반대'].map(side=>{const src=(raw.teams||[]).find(t=>t.side===side)||{};const sections=rubric.sections.map(section=>{const ss=(src.sections||[]).find(s=>s.id===section.id)||{};const criteria=section.criteria.map(c=>{const cc=(ss.criteria||[]).find(x=>x.id===c.id)||{};return {...c,score:clamp(cc.score,c.maxScore),judgment:String(cc.judgment||''),improvement:String(cc.improvement||''),evidence:Array.isArray(cc.evidence)?cc.evidence.slice(0,3):[]};});return {id:section.id,name:section.name,max_score:section.maxScore,score:criteria.reduce((a,c)=>a+c.score,0),summary:String(ss.summary||''),criteria};});const total=sections.reduce((a,s)=>a+s.score,0);const g=grade(total);return {side,total_score:total,grade:g.grade,grade_label:g.label,sections,strengths:(src.strengths||[]).slice(0,4),improvements:(src.improvements||[]).slice(0,4)};});
  return {version:rubric.version,teams,clashes:Array.isArray(raw.clashes)?raw.clashes.slice(0,6):[],participants:Array.isArray(raw.participants)?raw.participants:[],overall_comment:String(raw.overall_comment||'')};
}

async function evaluate(req,res){
  if(!API_KEY)return json(res,503,{error:'OPENAI_API_KEY가 설정되지 않았습니다.'});
  try{const p=await jsonBody(req);if(!String(p.topic||'').trim())return json(res,400,{error:'논제를 입력해 주세요.'});if(!(p.segments||[]).length)return json(res,400,{error:'전사문이 없습니다.'});
    const body={model:EVAL_MODEL,store:false,input:[{role:'user',content:[{type:'input_text',text:makePrompt(p)}]}],text:{format:{type:'json_object'}}};
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)return json(res,r.status,{error:d?.error?.message||'평가 요청에 실패했습니다.'});
    const text=outputText(d);let raw;try{raw=JSON.parse(text);}catch{throw new Error('평가 모델의 JSON 응답을 해석하지 못했습니다.');}json(res,200,{model:EVAL_MODEL,...normalizeEvaluation(raw)});
  }catch(e){console.error(e);json(res,500,{error:e.message||'평가 오류'});}
}

const demo={duration:76,segments:[
{id:'d1',start:0,end:14,speaker:'A',text:'지금부터 찬성 측 입론을 시작하겠습니다. 저희는 청소년의 심야 SNS 사용 시간을 제한해야 한다고 봅니다. 수면 부족과 학습 집중도 저하를 줄일 수 있기 때문입니다.'},
{id:'d2',start:15,end:28,speaker:'B',text:'찬성 측은 SNS가 수면 부족의 원인이라고 했는데 제시한 자료가 단순한 상관관계라면 인과관계를 어떻게 입증할 수 있습니까?'},
{id:'d3',start:29,end:42,speaker:'A',text:'상관관계만으로 충분하지 않다는 점은 인정합니다. 다만 사용 시간을 줄인 집단에서 수면 시간이 증가한 연구 결과를 추가 근거로 제시할 수 있습니다.'},
{id:'d4',start:43,end:58,speaker:'B',text:'그 연구에서도 학업 일정이나 가정환경 같은 다른 변수를 통제했는지 확인이 필요합니다. 통제하지 않았다면 정책 효과를 단정하기 어렵습니다.'},
{id:'d5',start:59,end:76,speaker:'A',text:'최종적으로 완전한 사용 금지가 아니라 심야 시간의 제한이라는 점이 중요합니다. 자유의 제한은 최소화하면서 수면이라는 직접적 이익을 확보할 수 있으므로 편익이 더 크다고 봅니다.'}]};

async function serve(req,res){let path=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname;if(path==='/')path='/index.html';path=normalize(path).replace(/^(\.\.(\/|\\|$))+/,'');const file=join(ROOT,'public',path);if(!file.startsWith(join(ROOT,'public')))return json(res,403,{error:'금지된 경로입니다.'});try{const data=await readFile(file);res.writeHead(200,{'content-type':MIME[extname(file)]||'application/octet-stream'});res.end(data);}catch{json(res,404,{error:'Not found'});}}

const server=http.createServer(async(req,res)=>{const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,apiKeyConfigured:Boolean(API_KEY),transcribeModel:TRANSCRIBE_MODEL,evaluationModel:EVAL_MODEL});if(req.method==='GET'&&u.pathname==='/api/rubric')return json(res,200,rubric);if(req.method==='GET'&&u.pathname==='/api/demo')return json(res,200,demo);if(req.method==='POST'&&u.pathname==='/api/transcribe')return transcribe(req,res);if(req.method==='POST'&&u.pathname==='/api/evaluate')return evaluate(req,res);return serve(req,res);});
server.listen(PORT,()=>console.log(`ADE running on http://localhost:${PORT}`));
