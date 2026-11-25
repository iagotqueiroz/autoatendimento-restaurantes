-- Execute no cliente mysql como administrador local, na primeira instalação.
CREATE DATABASE IF NOT EXISTS mesa_aberta CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS mesa_test CHARACTER SET utf8mb4;
CREATE USER 'mesa_app'@'127.0.0.1' IDENTIFIED BY RANDOM PASSWORD;
GRANT ALL PRIVILEGES ON mesa_aberta.* TO 'mesa_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON mesa_test.* TO 'mesa_app'@'127.0.0.1';

