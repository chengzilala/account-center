/**
 * AI Key 集成 · 厂商注册表（唯一真源）
 *
 * 口径：只收国内可直接申请的国产大模型平台；全部按 OpenAI 兼容协议调用。
 * 排序：DeepSeek 置顶推荐，其余按「用户量 / 上手难度」排。
 * 字段：
 *   id          唯一标识（存进 store 用，改名会让老配置失配，别动）
 *   name        面板上显示的名字
 *   recommended 是否首推（只应有一个）
 *   baseUrl     OpenAI 兼容的服务地址（末尾不带 /）
 *   models      候选模型（第一个为默认）
 *   applyUrl    申请 Key 的控制台地址
 *   keyPrefix   常见 Key 前缀，仅用于输入框提示与轻校验，不做强校验
 *   note        一句话提示（坑位 / 特殊要求）
 *
 * 维护：要加厂商只改本文件，然后各项目重跑 install.sh。
 * 地址与模型名以各平台控制台为准（记录时间 2026-10）；平台改名或改地址时，用户在
 * 「自定义端点」里手填即可，不必等母本更新。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.AIKeyProviders = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var LIST = [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      recommended: true,
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      applyUrl: 'https://platform.deepseek.com/api_keys',
      keyPrefix: 'sk-',
      note: '首推。默认模型必须显式关闭思考模式，否则 token 会多花好几倍'
    },
    {
      id: 'dashscope',
      name: '通义千问（阿里百炼）',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen3.7-plus', 'qwen3.8-flash', 'qwen3.8-max', 'qwen3.7-max', 'qwen3.7-flash', 'qwen3.6-plus'],
      applyUrl: 'https://bailian.console.aliyun.com/',
      keyPrefix: 'sk-',
      note: '阿里云百炼控制台 → API-KEY 里创建'
    },
    {
      id: 'ark',
      name: '豆包（火山方舟）',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      models: ['doubao-seed-2-1-pro-260915', 'doubao-seed-2-1-lite-260915', 'doubao-seed-2-1-turbo-260628', 'doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-mini-260428'],
      applyUrl: 'https://console.volcengine.com/ark',
      keyPrefix: '',
      note: '要先在「开通管理」里开通模型，模型名填推理接入点 ID（ep- 开头）或模型 ID'
    },
    {
      id: 'zhipu',
      name: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-4.7', 'glm-4.7-flash'],
      applyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
      keyPrefix: '',
      note: 'glm-5.3 默认开启思考；glm-4.7-flash 有免费额度，适合先试'
    },
    {
      id: 'moonshot',
      name: 'Kimi（月之暗面）',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
      applyUrl: 'https://platform.moonshot.cn/console/api-keys',
      keyPrefix: 'sk-',
      note: 'K2 系列将于 2026-12 底下线，新配置请用 K3.1 系列'
    },
    {
      id: 'siliconflow',
      name: '硅基流动',
      baseUrl: 'https://api.siliconflow.cn/v1',
      models: ['deepseek-ai/DeepSeek-V4-Flash', 'deepseek-ai/DeepSeek-V4-Pro', 'deepseek-ai/DeepSeek-V4.1-Flash', 'Qwen/Qwen3.8-27B', 'zai-org/GLM-5.3', 'moonshotai/Kimi-K2.7-Code'],
      applyUrl: 'https://cloud.siliconflow.cn/account/ak',
      keyPrefix: 'sk-',
      note: '一个 Key 通多家开源模型，模型名带厂商前缀'
    },
    {
      id: 'baidu',
      name: '百度文心（千帆）',
      baseUrl: 'https://qianfan.baidubce.com/v2',
      models: ['ernie-5.1', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'glm-5.3', 'qwen3.5-397b-a17b', 'kimi-k2.6'],
      applyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
      keyPrefix: 'bce-v3/',
      note: 'Key 是 bce-v3/ 开头的长串；千帆 v2 走 OpenAI 兼容协议'
    },
    {
      id: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimax.cn/v1',
      models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
      applyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
      keyPrefix: '',
      note: '长文本能力较强；控制台改版过，入口以实际为准'
    },
    {
      id: 'stepfun',
      name: '阶跃星辰',
      baseUrl: 'https://api.stepfun.com/v1',
      models: ['step-3.7-flash', 'step-5-preview', 'step-3.5-flash', 'step-3.5-flash-2603', 'step-1o-turbo-vision'],
      applyUrl: 'https://platform.stepfun.com/interface-key',
      keyPrefix: '',
      note: '国产多模态，文本走 step-2 系列'
    },
    {
      id: 'hunyuan',
      name: '腾讯混元',
      baseUrl: 'https://tokenhub.tencentmaas.com/v1',
      models: ['hy4-preview', 'hy3', 'hunyuan-role-latest', 'hy-mt2-pro', 'deepseek/deepseek-v4-pro', 'deepseek/deepseek-flash'],
      applyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
      keyPrefix: 'sk-',
      note: '已迁到腾讯云 TokenHub；旧混元模型 2026-06-26 起停止调用'
    },
    {
      id: 'custom',
      name: '自定义端点',
      custom: true,
      baseUrl: '',
      models: [],
      applyUrl: '',
      keyPrefix: '',
      note: '任何 OpenAI 兼容接口（含自建 / 第三方中转）都能填，地址与模型手填'
    }
  ];

  function byId(id) {
    for (var i = 0; i < LIST.length; i++) { if (LIST[i].id === id) { return LIST[i]; } }
    return null;
  }

  /** 按 baseUrl 反查厂商（用于回显已托管配置）；匹配不到返回 custom */
  function byBaseUrl(baseUrl) {
    var b = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!b) { return null; }
    for (var i = 0; i < LIST.length; i++) {
      if (!LIST[i].custom && LIST[i].baseUrl === b) { return LIST[i]; }
    }
    return byId('custom');
  }

  /** baseUrl + model 猜默认值；用于面板首次渲染 */
  function defaultOf(id) {
    var p = byId(id) || LIST[0];
    return { providerId: p.id, baseUrl: p.baseUrl, model: p.models[0] || '' };
  }

  return {
    list: LIST,
    byId: byId,
    byBaseUrl: byBaseUrl,
    defaultOf: defaultOf,
    defaultProviderId: 'deepseek'
  };
});
