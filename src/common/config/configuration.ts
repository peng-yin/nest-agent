/** 应用配置 — 生产环境必须通过环境变量设置 JWT_SECRET */
export default () => {
  const isProd = process.env.NODE_ENV === 'production';

  const jwtSecret = process.env.JWT_SECRET;
  if (isProd && !jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
    },
    database: {
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      username: process.env.MYSQL_USER || 'nest_agent',
      password: process.env.MYSQL_PASSWORD || 'nest_agent_pass',
      database: process.env.MYSQL_DATABASE || 'nest_agent',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    },
    jwt: {
      secret: jwtSecret || 'dev-only-secret',
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },
    milvus: {
      host: process.env.MILVUS_HOST || 'localhost',
      port: parseInt(process.env.MILVUS_PORT || '19530', 10),
    },
    memory: {
      windowSize: parseInt(process.env.MEMORY_WINDOW_SIZE || '10', 10),
      summaryThreshold: parseInt(process.env.MEMORY_SUMMARY_THRESHOLD || '20', 10),
    },
    llm: {
      defaultProvider: process.env.DEFAULT_LLM_PROVIDER || 'openai',
      defaultModel: process.env.DEFAULT_LLM_MODEL || 'gpt-4o',
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL,
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      dashscope: {
        apiKey: process.env.DASHSCOPE_API_KEY,
      },
    },
  };
};
