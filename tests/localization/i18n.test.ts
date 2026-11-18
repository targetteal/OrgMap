import test from 'node:test';
import assert from 'node:assert/strict';
import {SUPPORTED_LOCALES,catalogs,resolveLocale,createTranslator,createMessageTranslator,normalizePreferences,formatDate,formatInstant,formatNumber,parseDateOnly,parseInstant,compareText,pluralKey,formatError,dateAtInstant} from '../../packages/i18n/index';

test('eight locales contain actual translated UI messages; fallback never changes domain keys',()=>{
 assert.equal(SUPPORTED_LOCALES.length,8);
 const keys=Object.keys(catalogs['pt-BR']).sort();
 for(const locale of SUPPORTED_LOCALES){
  assert.deepEqual(Object.keys(catalogs[locale]).sort(),keys);
  assert.ok(Object.values(catalogs[locale]).every(v=>typeof v==='string'&&v.trim()));
  assert.equal(createTranslator(locale).t('common.save'),catalogs[locale]['common.save']);
 }
 assert.equal(new Set(SUPPORTED_LOCALES.map(l=>createTranslator(l).t('common.save'))).size,8);
 assert.equal(resolveLocale('en-GB'),'en-US');assert.equal(resolveLocale('pt-PT'),'pt-BR');assert.equal(resolveLocale('de'),'de-DE');assert.equal(resolveLocale('ar'),'pt-BR');assert.equal(resolveLocale('bogus%%%'),'pt-BR');
 assert.equal(createTranslator('xx').t('common.save'),'Salvar');
 const t=createMessageTranslator('fr-FR',{'pt-BR':{greeting:'Olá, {name}',count:'{n} itens'},'fr-FR':{greeting:'Bonjour, {name}'}});
 assert.equal(t('greeting',{name:'Ação — 日本語 <script>'}),'Bonjour, Ação — 日本語 <script>');assert.equal(t('count',{n:4}),'4 itens');
 assert.equal(t('greeting'),'Bonjour, {name}');
});
test('normalization is deterministic and unsupported values use explicit product defaults',()=>{
 assert.deepEqual(normalizePreferences({locale:'xx',timeZone:'../../bad',dateFormat:'automatic',reducedMotion:true}),{locale:'pt-BR',timeZone:'America/Sao_Paulo',dateFormat:'DD/MM/YYYY',reducedMotion:true});
 assert.equal(normalizePreferences({timeZone:'Europe/Berlin',locale:'de'}).timeZone,'Europe/Berlin');
});
test('civil dates preserve day across timezone boundaries and validate leap/rollover',()=>{
 for(const zone of ['Pacific/Kiritimati','America/Los_Angeles','Europe/Berlin']){
  assert.equal(formatDate('2024-02-29',{timeZone:zone}),'29/02/2024');
 }
 assert.equal(formatDate('2026-10-19',{dateFormat:'MM/DD/YYYY'}),'10/19/2026');
 assert.equal(formatDate('2026-10-19',{dateFormat:'YYYY-MM-DD'}),'2026-10-19');
 for(const invalid of ['2023-02-29','2026-04-31','2026-13-01','19/10/2026','2026-10-19T00:00:00Z',''])assert.equal(parseDateOnly(invalid),null);
 assert.equal(formatDate(null),'—');
 assert.equal(formatDate('2026-10-19',{locale:'fr-FR'},{month:'short'}),'oct.');
 assert.equal(formatDate('2026-10-19',{locale:'ja-JP'},{month:'short'}),'10月');
});
test('instants apply saved timezone, day rollover and actual DST transitions',()=>{
 assert.equal(formatInstant('2026-01-01T01:30:00Z',{timeZone:'America/Sao_Paulo'},false),'31/12/2025');
 assert.equal(dateAtInstant('2026-01-01T01:30:00Z',{timeZone:'America/Sao_Paulo'}),'2025-12-31');assert.equal(dateAtInstant('2026-01-01T01:30:00Z',{timeZone:'Asia/Tokyo'}),'2026-01-01');assert.equal(dateAtInstant('invalid'),null);
 const p={locale:'en-US',timeZone:'America/New_York',dateFormat:'YYYY-MM-DD'};
 const time={hour:'2-digit',minute:'2-digit',hourCycle:'h23'} as const;
 assert.equal(formatInstant('2026-03-08T06:59:00Z',p,true,time),'01:59');
 assert.equal(formatInstant('2026-03-08T07:00:00Z',p,true,time),'03:00');
 const offset={hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'} as const;
 assert.match(formatInstant('2026-11-01T05:30:00Z',p,true,offset),/01:30 GMT-4/);
 assert.match(formatInstant('2026-11-01T06:30:00Z',p,true,offset),/01:30 GMT-5/);
 for(const invalid of ['2026-10-19','2026-10-19T12:30','2026-02-30T00:00:00Z','2026-10-19T24:00:00Z','2026-10-19T12:60:00Z','invalid'])assert.equal(parseInstant(invalid),null);
 assert.equal(formatInstant(new Date('invalid')),'—');
});
test('numbers, collation and plural rules follow locale without mutating data',()=>{
 assert.equal(formatNumber(1234.5,{locale:'en-US'}),'1,234.5');assert.equal(formatNumber(1234.5,{locale:'pt-BR'}),'1.234,5');
 assert.equal(formatNumber(.25,{locale:'de-DE'},{style:'percent'}),'25 %');
 assert.equal(formatNumber(NaN),'—');assert.equal(formatNumber(Infinity),'—');assert.equal(formatNumber(0),'0');
 assert.ok(compareText('Papel 2','Papel 10','pt-BR')<0);assert.equal(pluralKey(1,'en-US'),'one');assert.equal(pluralKey(2,'en-US'),'other');assert.equal(pluralKey(1,'ja-JP'),'other');
});
test('safe translated errors cover all locales without interpolating raw server content',()=>{
 for(const locale of SUPPORTED_LOCALES){
  const denied=formatError({code:'ACTION_DENIED',message:'SYNTHETIC-PRIVATE-TEXT'},locale);assert.ok(denied.length>5);assert.ok(!denied.includes('PRIVATE'));
  assert.notEqual(denied,formatError({code:'NETWORK_ERROR'},locale));assert.equal(formatError({code:'UNRECOGNIZED',message:'SYNTHETIC-SECRET'},locale),formatError(null,locale));
 }
 assert.match(formatError({code:'VERSION_CONFLICT'},'en-US'),/data or state changed/);
});
