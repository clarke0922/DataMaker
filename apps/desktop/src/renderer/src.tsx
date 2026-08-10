import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider, Layout, Menu, Card, Col, Row, Statistic, Typography, Input, Table, Tag, Alert, Spin, Select, theme } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { ApartmentOutlined, DatabaseOutlined, DashboardOutlined, ImportOutlined, SafetyCertificateOutlined, SearchOutlined, SettingOutlined, TagsOutlined } from '@ant-design/icons';
import type { ManagementModule, MetadataStatsDto, SearchHitDto, SystemInfoDto } from '@datamaker/contracts';
import 'antd/dist/reset.css';
import './style.css';
import { ManagementPage, getManagementSpecs } from './ManagementPage';
import { I18nProvider, useI18n } from './i18n';

const EMPTY: MetadataStatsDto = { sources: 0, tables: 0, columns: 0, relations: 0, qualityIssues: 0 };

function Workspace() {
  const { locale, setLocale, t } = useI18n();
  const [info, setInfo] = useState<SystemInfoDto>();
  const [stats, setStats] = useState(EMPTY);
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string>('dashboard');
  const specs = getManagementSpecs(t);

  useEffect(() => {
    Promise.all([window.datamaker.system.info(), window.datamaker.metadata.stats()]).then(([system, metadata]) => {
      if (system.ok) setInfo(system.data); else setError(system.error.message);
      if (metadata.ok) setStats(metadata.data); else setError(metadata.error.message);
    }).catch(() => setError(t('Unable to connect to the main process service')));
  }, [t]);

  async function search(value: string) {
    const result = await window.datamaker.metadata.search(value);
    if (result.ok) setHits(result.data); else setError(result.error.message);
  }

  return <Layout className="shell">
    <Layout.Sider width={224} theme="light" className="sider">
      <div className="brand"><DatabaseOutlined /> DataMaker</div>
      <Menu mode="inline" selectedKeys={[selected]} onSelect={({ key }) => setSelected(key)} items={[
        { key: 'dashboard', icon: <DashboardOutlined />, label: t('Dashboard') },
        { key: 'metadata', icon: <DatabaseOutlined />, label: t('Metadata Management'), children: [
          { key: 'weights', label: t('Weight Scores') }, { key: 'dictionaries', label: t('Dictionary Data') },
          { key: 'dictionaryTree', label: t('Tree Dictionary') }, { key: 'factors', label: t('Factors') },
          { key: 'imports', icon: <ImportOutlined />, label: t('External Import') }, { key: 'tables', label: t('Data Tables') },
          { key: 'privateTables', label: t('Private Tables') }, { key: 'dailyCounts', label: t('Daily Counts') },
          { key: 'cubes', icon: <ApartmentOutlined />, label: t('Data Cubes') }, { key: 'categories', icon: <TagsOutlined />, label: t('Table Categories') }
        ] },
        { key: 'quality', icon: <SafetyCertificateOutlined />, label: t('Quality Center') },
        { key: 'settings', icon: <SettingOutlined />, label: t('System Management') }
      ]} />
    </Layout.Sider>
    <Layout>
      <Layout.Header className="header">
        <Typography.Title level={4}>{selected in specs ? specs[selected as ManagementModule].title : t('Metadata Workspace')}</Typography.Title>
        <div className="header-actions"><Tag color="blue">{t('Local mode')}</Tag><Select aria-label={t('Language')} value={locale} onChange={setLocale} style={{ width: 112 }} options={[{ value: 'en-US', label: t('English') }, { value: 'zh-CN', label: t('Chinese') }]} /></div>
      </Layout.Header>
      <Layout.Content className="content">
        {error && <Alert closable onClose={() => setError('')} type="error" message={error} />}
        {selected in specs ? <ManagementPage module={selected as ManagementModule} /> : <>
          {!info ? <Spin /> : !info.initialized && <Alert type="warning" showIcon message={t('The administrator account has not been initialized')} description={t('Administrator initialization will be completed in System Management.')} />}
          <Row gutter={[16, 16]} className="stats">
            {[[t('Data Sources'), stats.sources], [t('Data Tables'), stats.tables], [t('Fields'), stats.columns], [t('Relations'), stats.relations], [t('Quality Issues'), stats.qualityIssues]].map(([title, value]) =>
              <Col xs={24} sm={12} lg={Math.floor(24 / 5)} key={String(title)}><Card><Statistic title={title} value={value} /></Card></Col>)}
          </Row>
          <Card title={t('Global Search')} extra={<SearchOutlined />}>
            <Input.Search allowClear enterButton={t('Search')} placeholder={t('Search tables, fields, comments, or tags')} onSearch={search} />
            <Table className="results" rowKey="id" pagination={false} dataSource={hits} columns={[
              { title: t('Type'), dataIndex: 'objectType', width: 100, render: value => <Tag>{t(value === 'table' ? 'Table' : 'Field')}</Tag> },
              { title: t('Name'), dataIndex: 'name' }, { title: t('Path'), dataIndex: 'path' }, { title: t('Comment'), dataIndex: 'comment' }
            ]} />
          </Card>
        </>}
      </Layout.Content>
    </Layout>
  </Layout>;
}

function LocalizedApp() {
  const { locale } = useI18n();
  return <ConfigProvider locale={locale === 'zh-CN' ? zhCN : enUS} theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: '#2563eb', borderRadius: 8 } }}><AntApp><Workspace /></AntApp></ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><I18nProvider><LocalizedApp /></I18nProvider></React.StrictMode>);
