import { createMessageTranslator, SUPPORTED_LOCALES, type Locale } from '../../packages/i18n/index.js';

const rows = [
 ['origin','Origem','Origin','Origen','Origine','Ursprung','Origine','起点','Oorsprong'],
 ['destinations','Desdobramentos','Linked outcomes','Resultados vinculados','Éléments liés','Verknüpfte Ergebnisse','Risultati collegati','関連する成果','Gekoppelde resultaten'],
 ['back','Voltar à origem','Back to origin','Volver al origen','Retour à l’origine','Zurück zum Ursprung','Torna all’origine','起点に戻る','Terug naar oorsprong'],
 ['loading','Carregando vínculos…','Loading links…','Cargando vínculos…','Chargement des liens…','Verknüpfungen werden geladen…','Caricamento dei collegamenti…','関連情報を読み込み中…','Koppelingen laden…'],
 ['error','Não foi possível carregar os vínculos.','Could not load links.','No se pudieron cargar los vínculos.','Impossible de charger les liens.','Verknüpfungen konnten nicht geladen werden.','Impossibile caricare i collegamenti.','関連情報を読み込めませんでした。','Koppelingen konden niet worden geladen.'],
 ['TENSION','Tensão','Tension','Tensión','Tension','Spannung','Tensione','テンション','Spanning'],
 ['TASK','Tarefa','Task','Tarea','Tâche','Aufgabe','Attività','タスク','Taak'],
 ['PROJECT','Projeto','Project','Proyecto','Projet','Projekt','Progetto','プロジェクト','Project'],
 ['GOAL','Objetivo','Goal','Objetivo','Objectif','Ziel','Obiettivo','目標','Doel'],
 ['AGENDA','Item de agenda','Agenda item','Punto de agenda','Point à l’ordre du jour','Tagesordnungspunkt','Punto all’ordine del giorno','議題','Agendapunt'],
 ['MEETING','Reunião','Meeting','Reunión','Réunion','Besprechung','Riunione','会議','Vergadering'],
 ['PROPOSAL','Proposta','Proposal','Propuesta','Proposition','Vorschlag','Proposta','提案','Voorstel'],
] as const;
type Key=(typeof rows)[number][0];
const messages=Object.fromEntries(SUPPORTED_LOCALES.map((locale,index)=>[locale,Object.fromEntries(rows.map(row=>[row[0],row[index+1]]))])) as Record<Locale,Record<Key,string>>;
export const traceTranslator=(locale:string)=>createMessageTranslator(locale,messages);
