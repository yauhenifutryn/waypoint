import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({role:'owner',requestDeploy:vi.fn(),stopDeployment:vi.fn(),triggerManualRun:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:mocks.role})})}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw new Error('REDIRECT '+url);}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/service',()=>({requestDeploy:mocks.requestDeploy,stopDeployment:mocks.stopDeployment}));
vi.mock('@/server/supervisor/main',()=>({triggerManualRun:mocks.triggerManualRun}));
import {deployVersion,runJobNow,stopDeploymentAction} from './actions';
beforeEach(()=>{mocks.role='owner';mocks.requestDeploy.mockReset();mocks.stopDeployment.mockReset();mocks.triggerManualRun.mockReset();});
it('owner deployment reaches the authoritative service gate from the product action',async()=>{
 const form=new FormData();form.set('versionId','version');form.set('back','/apps/report?tab=runtime');
 await expect(deployVersion(form)).rejects.toThrow('REDIRECT /apps/report?tab=runtime');
 expect(mocks.requestDeploy).toHaveBeenCalledWith({versionId:'version',role:'owner',actorLabel:'Owner'});
});
it('auditors cannot reach the deployment service',async()=>{
 mocks.role='auditor';await expect(deployVersion(new FormData())).rejects.toThrow('Separation');expect(mocks.requestDeploy).not.toHaveBeenCalled();
});
it('service policy rejection remains visible and does not become successful deployment',async()=>{
 mocks.requestDeploy.mockImplementation(()=>{throw new Error('Not automatically approved');});
 await expect(deployVersion(new FormData())).rejects.toThrow('Not%20automatically%20approved');
});
it('owner controls reach the running deployment gate and stop operation',async()=>{
 const form=new FormData();form.set('deploymentId','deployment');form.set('appId','app');
 await expect(runJobNow(form)).rejects.toThrow('REDIRECT');expect(mocks.triggerManualRun).toHaveBeenCalledWith('deployment');
 await expect(stopDeploymentAction(form)).rejects.toThrow('REDIRECT');expect(mocks.stopDeployment).toHaveBeenCalledWith({appId:'app',role:'owner',actorLabel:'Owner'});
});
