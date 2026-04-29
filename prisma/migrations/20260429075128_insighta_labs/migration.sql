-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `github_id` VARCHAR(64) NOT NULL,
    `username` VARCHAR(128) NOT NULL,
    `email` VARCHAR(256) NULL,
    `avatar_url` VARCHAR(512) NULL,
    `role` ENUM('admin', 'analyst') NOT NULL DEFAULT 'analyst',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_github_id_key`(`github_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `token_hash` VARCHAR(256) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    INDEX `refresh_tokens_token_hash_revoked_expires_at_idx`(`token_hash`, `revoked`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `profiles` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(256) NOT NULL,
    `gender` VARCHAR(16) NOT NULL,
    `gender_probability` DOUBLE NOT NULL,
    `age` INTEGER NOT NULL,
    `age_group` VARCHAR(16) NOT NULL,
    `country_id` VARCHAR(2) NOT NULL,
    `country_name` VARCHAR(128) NOT NULL,
    `country_probability` DOUBLE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `profiles_name_key`(`name`),
    INDEX `profiles_gender_idx`(`gender`),
    INDEX `profiles_age_group_idx`(`age_group`),
    INDEX `profiles_country_id_idx`(`country_id`),
    INDEX `profiles_age_idx`(`age`),
    INDEX `profiles_gender_country_id_idx`(`gender`, `country_id`),
    INDEX `profiles_country_id_age_idx`(`country_id`, `age`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
