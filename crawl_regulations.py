# -*- coding: utf-8 -*-
"""
定向爬虫 v2：抓取 ICAO、CAAC、FAA 航空法规原文
仅爬取 icao.int, caac.gov.cn, legacy.icao.int, faa.gov, ecfr.gov
使用 eCFR 公开 API，改进 User-Agent 和重试策略
"""
import requests
import json
import re
import os
import time
import sys

# 设置控制台编码
sys.stdout.reconfigure(encoding='utf-8')

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

def safe_get(url, retries=3, delay=5, stream=False):
    """安全请求，带重试"""
    for attempt in range(retries):
        try:
            resp = SESSION.get(url, timeout=45, verify=True, stream=stream)
            if stream:
                return resp
            resp.encoding = resp.apparent_encoding or 'utf-8'
            return resp
        except Exception as e:
            print(f"  [!] 请求失败 (尝试 {attempt+1}/{retries}): {type(e).__name__}: {e}")
            if attempt < retries - 1:
                time.sleep(delay)
    return None

def safe_get_json(url, retries=3, delay=5):
    """安全请求JSON API"""
    for attempt in range(retries):
        try:
            resp = SESSION.get(url, timeout=45, verify=True)
            return resp.json()
        except Exception as e:
            print(f"  [!] JSON请求失败 (尝试 {attempt+1}/{retries}): {type(e).__name__}: {e}")
            if attempt < retries - 1:
                time.sleep(delay)
    return None

def clean_text(text):
    """清洗多余空白，保留法规原文"""
    text = re.sub(r'[\r\n]{3,}', '\n\n', text)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    text = text.strip()
    return text

def extract_text_from_html(html):
    """从HTML提取纯文本"""
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<noscript[^>]*>.*?</noscript>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    # 正确解码 HTML 实体
    import html as _html_mod
    text = _html_mod.unescape(text)
    text = re.sub(r'&#?\w+;', ' ', text)
    return clean_text(text)

def extract_meaningful_lines(text, min_len=80):
    """提取有实质内容的行"""
    meaningful = []
    for line in text.split('\n'):
        line = line.strip()
        if len(line) > min_len and not re.match(r'^[\s\W]*$', line):
            # 过滤导航/UI/政府网站通用banner
            if not re.search(r'(?:Skip to|Menu|Navigation|Search|Home|Contact|About Us|Privacy|Cookie|language|简体|繁體|English|Français|Español|Русский|العربية|中文|safely connected|belongs to an official|Share sensitive information)', line, re.IGNORECASE):
                meaningful.append(line)
    return meaningful

def is_quality_content(text):
    """检查内容是否高质量（非纯banner/导航）"""
    if len(text) < 200:
        return False
    # 过滤纯政府网站banner
    banner_patterns = [
        r'^Official websites use \.gov.*safely connected',
        r'^A lock \(.*safely connected to the \.gov website',
    ]
    for pat in banner_patterns:
        if re.match(pat, text.strip(), re.DOTALL):
            return False
    return True

def split_into_chunks(text, max_chars=2500):
    """将长文本拆分为独立知识点"""
    paragraphs = re.split(r'\n{2,}', text)
    chunks = []
    current = ''
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(current) + len(para) < max_chars:
            current = (current + '\n\n' + para).strip()
        else:
            if current and len(current) > 150:
                chunks.append(current)
            current = para
    if current and len(current) > 150:
        chunks.append(current)
    return chunks

# ═══════════════════════════════════════════════
# 阶段1：ICAO 官网 (尝试多种方式)
# ═══════════════════════════════════════════════

def crawl_icao():
    """爬取 ICAO 公开文档 - 尝试多个入口"""
    results = []
    urls = [
        ('https://www.icao.int/safety/airnavigation/Pages/standards.aspx', 'ICAO Standards'),
        ('https://www.icao.int/safety/Pages/default.aspx', 'ICAO Safety'),
        ('https://www.icao.int/secretariat/Pages/default.aspx', 'ICAO Secretariat'),
        ('https://www.icao.int/environmental-protection/CORSIA/Pages/default.aspx', 'ICAO CORSIA'),
        ('https://www.icao.int/Meetings/Pages/default.aspx', 'ICAO Meetings'),
        ('https://www.icao.int/safety/FSMP/Pages/default.aspx', 'ICAO FSMP'),
        ('https://www.icao.int/safety/UA/Pages/default.aspx', 'ICAO UAV'),
        ('https://store.icao.int/en/', 'ICAO Store'),
    ]
    
    for url, label in urls:
        print(f'[ICAO] {label}: {url}')
        resp = safe_get(url)
        if resp and resp.status_code == 200:
            text = extract_text_from_html(resp.text)
            lines = extract_meaningful_lines(text, min_len=60)
            if lines:
                content = '\n\n'.join(lines[:30])
                chunks = split_into_chunks(content[:4000], 2000)
                for i, chunk in enumerate(chunks):
                    results.append({
                        'title': f'ICAO - {label} (Part {i+1})',
                        'detail': chunk,
                        'source': url,
                        'category': '航空行业法规'
                    })
            print(f'  [OK] {len(text)} 字符, 提取 {len(lines)} 行有意义内容')
        else:
            status = resp.status_code if resp else 'None'
            print(f'  [FAIL] HTTP {status}')
    return results


# ═══════════════════════════════════════════════
# 阶段2：CAAC 官网 (尝试更多具体页面)
# ═══════════════════════════════════════════════

def crawl_caac():
    """爬取中国民航局 CCAR 规章"""
    results = []
    urls = [
        ('https://www.caac.gov.cn/XXGK/XXGK/FLFG/', 'CAAC法律法规'),
        ('https://www.caac.gov.cn/XXGK/XXGK/GFXWJ/', 'CAAC规范性文件'),
        ('https://www.caac.gov.cn/XXGK/XXGK/ZCFB/', 'CAAC政策发布'),
        ('https://www.caac.gov.cn/XXGK/XXGK/TZTG/', 'CAAC通知公告'),
        ('https://www.caac.gov.cn/XXGK/XXGK/', 'CAAC信息公开'),
        ('https://www.caac.gov.cn/INDEX/', 'CAAC索引'),
        ('https://www.caac.gov.cn/big5/', 'CAAC繁体'),
        ('https://www.caac.gov.cn/XXGK/XXGK/MHGZ/', 'CAAC民航规章'),
    ]
    
    for url, label in urls:
        print(f'[CAAC] {label}: {url}')
        resp = safe_get(url)
        if resp and resp.status_code == 200:
            text = extract_text_from_html(resp.text)
            lines = extract_meaningful_lines(text, min_len=40)
            if lines:
                content = '\n\n'.join(lines[:30])
                chunks = split_into_chunks(content[:4000], 2000)
                for i, chunk in enumerate(chunks):
                    results.append({
                        'title': f'CAAC - {label} (Part {i+1})',
                        'detail': chunk,
                        'source': url,
                        'category': '航空行业法规'
                    })
            print(f'  [OK] {len(text)} 字符, 提取 {len(lines)} 行有意义内容')
        else:
            status = resp.status_code if resp else 'None'
            print(f'  [FAIL] HTTP {status}')
    return results


# ═══════════════════════════════════════════════
# 阶段3：FAA 官网 + eCFR API
# ═══════════════════════════════════════════════

def crawl_faa_web():
    """爬取 FAA 官网页面"""
    results = []
    urls = [
        ('https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/', 'FAA Handbooks'),
        ('https://www.faa.gov/regulations_policies/advisory_circulars/', 'FAA Advisory Circulars'),
        ('https://www.faa.gov/aircraft/air_cert/design_approvals/', 'FAA Design Approvals'),
        ('https://www.faa.gov/aircraft/air_cert/continued_airworthiness/', 'FAA Continued Airworthiness'),
        ('https://www.faa.gov/licenses_certificates/aircraft_certification/', 'FAA Aircraft Certification'),
        ('https://www.faa.gov/about/office_org/headquarters_offices/avs/offices/air/', 'FAA AIR'),
    ]
    
    for url, label in urls:
        print(f'[FAA] {label}: {url}')
        resp = safe_get(url)
        if resp and resp.status_code == 200:
            text = extract_text_from_html(resp.text)
            lines = extract_meaningful_lines(text, min_len=80)
            if lines:
                content = '\n\n'.join(lines[:30])
                chunks = split_into_chunks(content[:4000], 2000)
                for i, chunk in enumerate(chunks):
                    results.append({
                        'title': f'FAA - {label} (Part {i+1})',
                        'detail': chunk,
                        'source': url,
                        'category': '航空行业法规'
                    })
            print(f'  [OK] {len(text)} 字符, 提取 {len(lines)} 行有意义内容')
        else:
            status = resp.status_code if resp else 'None'
            print(f'  [FAIL] HTTP {status}')
    return results


def crawl_ecfr_api():
    """使用 eCFR 公开 API 获取 14 CFR 法规"""
    results = []
    
    # eCFR.gov 公开 API
    # 14 CFR 主要 Part 列表
    title_14_parts = [
        ('part-1', '14 CFR Part 1 - Definitions'),
        ('part-21', '14 CFR Part 21 - Certification Procedures'),
        ('part-25', '14 CFR Part 25 - Airworthiness Standards: Transport Category'),
        ('part-33', '14 CFR Part 33 - Airworthiness Standards: Aircraft Engines'),
        ('part-43', '14 CFR Part 43 - Maintenance, Preventive Maintenance'),
        ('part-61', '14 CFR Part 61 - Certification: Pilots'),
        ('part-91', '14 CFR Part 91 - General Operating Rules'),
        ('part-121', '14 CFR Part 121 - Operating Requirements: Domestic'),
        ('part-135', '14 CFR Part 135 - Operating Requirements: Commuter'),
        ('part-145', '14 CFR Part 145 - Repair Stations'),
    ]
    
    base_url = 'https://www.ecfr.gov'
    
    for part_slug, label in title_14_parts:
        # 尝试 API 端点
        api_url = f'https://www.ecfr.gov/api/versioner/v1/structure/2026-07-09/title-14/{part_slug}'
        print(f'[eCFR API] {label}: {api_url}')
        
        data = safe_get_json(api_url)
        if data:
            # 提取结构中的文本
            texts = []
            def extract_text_from_node(node, depth=0):
                if isinstance(node, dict):
                    if 'label_description' in node:
                        texts.append(f"{node.get('label', '')} {node['label_description']}")
                    if 'children' in node:
                        for child in node['children']:
                            extract_text_from_node(child, depth+1)
                elif isinstance(node, list):
                    for item in node:
                        extract_text_from_node(item, depth+1)
            
            try:
                if isinstance(data, list):
                    for item in data:
                        extract_text_from_node(item)
                elif isinstance(data, dict):
                    extract_text_from_node(data)
                
                if texts:
                    content = '\n'.join(texts[:100])  # 取前100条
                    chunks = split_into_chunks(content[:5000], 2000)
                    for i, chunk in enumerate(chunks):
                        results.append({
                            'title': f'{label} (Part {i+1})',
                            'detail': chunk,
                            'source': f'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-C/{part_slug}',
                            'category': '航空行业法规'
                        })
                    print(f'  [OK] 提取 {len(texts)} 条法规文本')
                else:
                    print(f'  [WARN] 无文本内容')
            except Exception as e:
                print(f'  [ERR] 解析失败: {e}')
        else:
            # 尝试备用API
            alt_url = f'https://www.ecfr.gov/api/versioner/v1/full/2026-07-09/title-14.xml?part={part_slug.split("-")[1]}'
            print(f'  [RETRY] 备用API: {alt_url}')
            resp = safe_get(alt_url)
            if resp and resp.status_code == 200:
                text = extract_text_from_html(resp.text)
                lines = extract_meaningful_lines(text, min_len=80)
                if lines:
                    content = '\n\n'.join(lines[:50])
                    chunks = split_into_chunks(content[:5000], 2000)
                    for i, chunk in enumerate(chunks):
                        results.append({
                            'title': f'{label} (Part {i+1})',
                            'detail': chunk,
                            'source': f'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-C/{part_slug}',
                            'category': '航空行业法规'
                        })
                    print(f'  [OK] XML提取 {len(lines)} 行')
                else:
                    print(f'  [WARN] XML无有意义内容')
            else:
                print(f'  [FAIL] 备用API也失败')
        
        time.sleep(1)  # 速率限制
    
    return results


def crawl_faa():
    """爬取 FAA 所有来源"""
    results = []
    results.extend(crawl_faa_web())
    results.extend(crawl_ecfr_api())
    return results


# ═══════════════════════════════════════════════
# 阶段4：legacy.icao.int
# ═══════════════════════════════════════════════

def crawl_legacy_icao():
    """legacy.icao.int DNS 不解析，跳过"""
    print('[LEGACY-ICAO] DNS 解析失败，跳过 legacy.icao.int')
    return []


# ═══════════════════════════════════════════════
# 主函数
# ═══════════════════════════════════════════════

def main():
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    print('=' * 60)
    print('航空法规爬虫 v2 - 定向抓取 ICAO / CAAC / FAA / eCFR')
    print('=' * 60)
    
    all_results = []
    
    # 先恢复 quiz_bank.json 到原始状态（移除之前爬取的质量不高的内容）
    bank_path = os.path.join(os.path.dirname(__file__), 'static', 'data', 'quiz_bank.json')
    with open(bank_path, 'r', encoding='utf-8') as f:
        bank = json.load(f)
    
    # 移除之前添加的 kb016, kb017 (质量不高的FAA页面)
    removed = []
    for kid in ['kb016', 'kb017']:
        if kid in bank['knowledge_details']:
            del bank['knowledge_details'][kid]
            removed.append(kid)
    if removed:
        with open(bank_path, 'w', encoding='utf-8') as f:
            json.dump(bank, f, ensure_ascii=False, indent=4)
        print(f'[清理] 已移除低质量条目: {removed}')
    
    print('\n--- 阶段1: ICAO ---')
    icao_results = crawl_icao()
    all_results.extend(icao_results)
    print(f'[阶段1] 共获取 {len(icao_results)} 条')
    
    print('\n--- 阶段2: CAAC ---')
    caac_results = crawl_caac()
    all_results.extend(caac_results)
    print(f'[阶段2] 共获取 {len(caac_results)} 条')
    
    print('\n--- 阶段3: FAA + eCFR ---')
    faa_results = crawl_faa()
    all_results.extend(faa_results)
    print(f'[阶段3] 共获取 {len(faa_results)} 条')
    
    print('\n--- 阶段4: Legacy ICAO ---')
    legacy_results = crawl_legacy_icao()
    all_results.extend(legacy_results)
    print(f'[阶段4] 共获取 {len(legacy_results)} 条')
    
    print(f'\n总计获取: {len(all_results)} 条知识点')
    
    if not all_results:
        print('[!] 未获取到任何内容。')
        return
    
    # 重新载入（已清理的）
    with open(bank_path, 'r', encoding='utf-8') as f:
        bank = json.load(f)
    
    # 获取当前最大 kb ID
    existing_ids = list(bank['knowledge_details'].keys())
    max_num = 0
    for kid in existing_ids:
        match = re.match(r'kb(\d+)', kid)
        if match:
            num = int(match.group(1))
            if num > max_num:
                max_num = num
    
    # 去重
    existing_titles = {v['title'] for v in bank['knowledge_details'].values()}
    added_count = 0
    
    for item in all_results:
        title = item['title']
        detail = item['detail']
        if title in existing_titles:
            continue
        if not is_quality_content(detail):
            print(f'  [SKIP] 低质量: {title[:60]}')
            continue
        max_num += 1
        new_id = f'kb{max_num:03d}'
        entry = {
            'id': new_id,
            'title': title,
            'content': detail,
            'category': 'regulations',
            'source': item.get('source', '')
        }
        bank['knowledge_details'][new_id] = entry
        existing_titles.add(title)
        added_count += 1
    
    # 写入文件
    with open(bank_path, 'w', encoding='utf-8') as f:
        json.dump(bank, f, ensure_ascii=False, indent=4)
    
    print(f'\n[完成] 成功新增 {added_count} 条知识点，写入 {bank_path}')
    print(f'知识库总数: {len(bank["knowledge_details"])} 条')
    
    # 校验 JSON
    with open(bank_path, 'r', encoding='utf-8') as f:
        test = json.load(f)
    print(f'[校验] JSON 格式正确，共 {len(test["knowledge_details"])} 条知识点, {len(test["questions"])} 道题目')

if __name__ == '__main__':
    main()