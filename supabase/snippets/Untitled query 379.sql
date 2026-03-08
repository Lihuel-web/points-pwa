-- Escaneo del schema para identificar vectores de relación en las tablas vulnerables
SELECT 
    table_name, 
    column_name, 
    data_type 
FROM 
    information_schema.columns 
WHERE 
    table_name IN ('game_scores_orbit', 'team_pool_tx', 'team_pool_tx_archive') 
    AND table_schema = 'public';