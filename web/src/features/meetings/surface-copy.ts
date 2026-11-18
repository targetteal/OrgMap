export const meetingCopy=(locale:string,key:'search'|'clearSearch'|'close'|'expand'|'reduce'|'open'|'noResults'|'mine'|'all'|'presentation'|'upcoming'|'history'|'period')=>{
 const values:Record<string,string[]>={
  'pt-BR':['Pesquisar reuniões','Limpar pesquisa','Fechar detalhes','Expandir detalhes','Reduzir detalhes','Abrir reunião','Nenhum resultado nesta página','Minhas reuniões','Todas',"Filtros e visualização","Em andamento e próximas","Histórico completo","Período dos encontros"],
  'en-US':['Search meetings','Clear search','Close details','Expand details','Reduce details','Open meeting','No results on this page','My meetings','All',"Filters and view","In progress and upcoming","Full history","Meeting period"],
  'es-ES':['Buscar reuniones cargadas','Borrar búsqueda','Cerrar detalles','Ampliar detalles','Reducir detalles','Abrir reunión','Sin resultados en esta página','Mis reuniones','Todas',"Filtros y vista","En curso y próximas","Historial completo","Período de reuniones"],
  'fr-FR':['Rechercher les réunions chargées','Effacer la recherche','Fermer les détails','Agrandir les détails','Réduire les détails','Ouvrir la réunion','Aucun résultat sur cette page','Mes réunions','Toutes',"Filtres et affichage","En cours et à venir","Historique complet","Période des réunions"],
  'de-DE':['Geladene Termine durchsuchen','Suche löschen','Details schließen','Details vergrößern','Details verkleinern','Besprechung öffnen','Keine Ergebnisse auf dieser Seite','Meine Besprechungen','Alle',"Filter und Ansicht","Laufend und bevorstehend","Gesamter Verlauf","Besprechungszeitraum"],
  'it-IT':['Cerca riunioni caricate','Cancella ricerca','Chiudi dettagli','Espandi dettagli','Riduci dettagli','Apri riunione','Nessun risultato in questa pagina','Le mie riunioni','Tutte',"Filtri e vista","In corso e in arrivo","Cronologia completa","Periodo delle riunioni"],
  'ja-JP':['読み込んだ会議を検索','検索を消去','詳細を閉じる','詳細を拡大','詳細を縮小','会議を開く','このページに結果はありません','自分の会議','すべて',"絞り込みと表示","進行中・開催予定","すべての履歴","会議の期間"],
  'nl-NL':['Geladen bijeenkomsten zoeken','Zoekopdracht wissen','Details sluiten','Details vergroten','Details verkleinen','Bijeenkomst openen','Geen resultaten op deze pagina','Mijn bijeenkomsten','Alle',"Filters en weergave","Bezig en gepland","Volledige geschiedenis","Vergaderperiode"],
 };
 return (values[locale]??values['pt-BR'])[['search','clearSearch','close','expand','reduce','open','noResults','mine','all','presentation','upcoming','history','period'].indexOf(key)];
};
