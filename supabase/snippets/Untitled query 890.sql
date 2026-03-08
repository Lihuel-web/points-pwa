-- Extracción del Data Definition Language (DDL) de la vista vulnerable
SELECT view_definition 
FROM information_schema.views 
WHERE table_schema = 'public' AND table_name = 'game_local_best';