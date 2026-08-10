import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider, Layout, Menu, Card, Col, Row, Statistic, Typography, Input, Table, Tag, Alert, Spin, theme } from 'antd';
import { ApartmentOutlined, DatabaseOutlined, DashboardOutlined, ImportOutlined, SafetyCertificateOutlined, SearchOutlined, SettingOutlined, TagsOutlined } from '@ant-design/icons';
import type { ManagementModule, MetadataStatsDto, SearchHitDto, SystemInfoDto } from '@datamaker/contracts';
import 'antd/dist/reset.css';
import './style.css';
import { ManagementPage, managementSpecs } from './ManagementPage';

const EMPTY: MetadataStatsDto = { sources: 0, tables: 0, columns: 0, relations: 0, qualityIssues: 0 };

function Workspace() {
  const [info, setInfo] = useState<SystemInfoDto>();
  const [stats, setStats] = useState(EMPTY);
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string>('dashboard');

  useEffect(() => {
    Promise.all([window.datamaker.system.info(), window.datamaker.metadata.stats()]).then(([system, metadata]) => {
      if (system.ok) setInfo(system.data); else setError(system.error.message);
      if (metadata.ok) setStats(metadata.data); else setError(metadata.error.message);
    }).catch(() => setError('无法连接主进程服务'));
  }, []);

  async function search(value: string) {
    const result = await window.datamaker.metadata.search(value);
    if (result.ok) setHits(result.data); else setError(result.error.message);
  }

  return <Layout className="shell">
    <Layout.Sider width={224} theme="light" className="sider">
      <div className="brand"><DatabaseOutlined /> DataMaker</div>
      <Menu mode="inline" selectedKeys={[selected]} onSelect={({ key }) => setSelected(key)} items={[
        { key: 'dashboard', icon: <DashboardOutlined />, label: '工作台' },
        { key: 'metadata', icon: <DatabaseOutlined />, label: '元数据管理', children: [
          { key: 'weights', label: '权重分数表' },
          { key: 'dictionaries', label: '字典数据' },
          { key: 'dictionaryTree', label: '树形字典数据' },
          { key: 'factors', label: '要素表' },
          { key: 'imports', icon: <ImportOutlined />, label: '外部数据导入' },
          { key: 'tables', label: '数据表' },
          { key: 'privateTables', label: '私有数据表' },
          { key: 'dailyCounts', label: '每日增量总数' },
          { key: 'cubes', icon: <ApartmentOutlined />, label: '数据立方' },
          { key: 'categories', icon: <TagsOutlined />, label: '表分类' }
        ] },
        { key: 'quality', icon: <SafetyCertificateOutlined />, label: '质量中心' },
        { key: 'settings', icon: <SettingOutlined />, label: '系统管理' }
      ]} />
    </Layout.Sider>
    <Layout>
      <Layout.Header className="header"><Typography.Title level={4}>{selected in managementSpecs ? managementSpecs[selected as ManagementModule].title : '元数据工作台'}</Typography.Title><Tag color="blue">本地模式</Tag></Layout.Header>
      <Layout.Content className="content">
        {error && <Alert closable onClose={() => setError('')} type="error" message={error} />}
        {selected in managementSpecs ? <ManagementPage module={selected as ManagementModule} /> : <>
        {!info ? <Spin /> : !info.initialized && <Alert type="warning" showIcon message="系统尚未初始化管理员账户" description="管理员初始化将在系统管理模块完成。" />}
        <Row gutter={[16, 16]} className="stats">
          {[['数据源', stats.sources], ['数据表', stats.tables], ['字段', stats.columns], ['关系', stats.relations], ['质量问题', stats.qualityIssues]].map(([title, value]) =>
            <Col xs={24} sm={12} lg={Math.floor(24 / 5)} key={String(title)}><Card><Statistic title={title} value={value} /></Card></Col>)}
        </Row>
        <Card title="全局搜索" extra={<SearchOutlined />}>
          <Input.Search allowClear enterButton="搜索" placeholder="搜索表、字段、注释或标签" onSearch={search} />
          <Table className="results" rowKey="id" pagination={false} dataSource={hits} columns={[
            { title: '类型', dataIndex: 'objectType', width: 100, render: v => <Tag>{v === 'table' ? '表' : '字段'}</Tag> },
            { title: '名称', dataIndex: 'name' }, { title: '路径', dataIndex: 'path' }, { title: '注释', dataIndex: 'comment' }
          ]} />
        </Card>
        </>}
      </Layout.Content>
    </Layout>
  </Layout>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: '#2563eb', borderRadius: 8 } }}><AntApp><Workspace /></AntApp></ConfigProvider></React.StrictMode>);
